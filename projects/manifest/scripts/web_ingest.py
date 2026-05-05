# scripts/web_ingest.py

import sys
import os
from uuid import uuid4
from datetime import datetime

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import requests
from bs4 import BeautifulSoup
from sentence_transformers import SentenceTransformer

from vectorstore.pgvector import PGVectorStore
from utils.text_utils import chunk_text

# Local embedding model
# all-MiniLM-L6-v2 outputs 384-dimensional vectors,
# matching your current pgvector table: embedding vector(384)
model = SentenceTransformer("all-MiniLM-L6-v2")


def fetch_and_clean_url(url):
    response = requests.get(
        url,
        timeout=20,
        headers={
            "User-Agent": "ManifestResearchBot/0.1 (+https://3wh.dev)"
        }
    )
    response.raise_for_status()

    soup = BeautifulSoup(response.content, "html.parser")

    for tag in soup(["script", "style", "noscript"]):
        tag.decompose()

    text = soup.get_text(separator=" ")
    return " ".join(text.split())


def embed_chunks(chunks):
    return [model.encode(chunk).tolist() for chunk in chunks]


def ingest_url(url):
    print(f"Ingesting: {url}")

    text = fetch_and_clean_url(url)

    if not text:
        print("No text found.")
        return

    chunks = chunk_text(text, max_tokens=500)

    if not chunks:
        print("No chunks created.")
        return

    embeddings = embed_chunks(chunks)

    store = PGVectorStore()
    documents = []

    for i, (chunk, embedding) in enumerate(zip(chunks, embeddings)):
        documents.append({
            "id": str(uuid4()),
            "source": url,
            "chunk_index": i,
            "text": chunk,
            "embedding": embedding,
            "timestamp": datetime.utcnow(),
            "entities": []
        })

    store.add_documents(documents)

    print(f"{len(chunks)} chunks ingested from {url}")


if __name__ == "__main__":
    url = input("Enter URL to ingest: ").strip()
    ingest_url(url)
