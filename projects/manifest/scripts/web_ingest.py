# scripts/web_ingest.py
import sys
import os
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import requests
from bs4 import BeautifulSoup
import tiktoken
import openai
from vectorstore.pgvector import PGVectorStore
from utils.text_utils import chunk_text

def fetch_and_clean_url(url):
    response = requests.get(url)
    soup = BeautifulSoup(response.content, "html.parser")

    # Remove script and style
    for tag in soup(["script", "style", "noscript"]):
        tag.decompose()

    text = soup.get_text(separator=" ")
    cleaned_text = " ".join(text.split())
    return cleaned_text

def embed_chunks(chunks):
    embeddings = []
    for chunk in chunks:
        response = openai.Embedding.create(
            input=chunk,
            model="text-embedding-ada-002"
        )
        embeddings.append(response["data"][0]["embedding"])
    return embeddings

def ingest_url(url):
    print(f"Ingesting: {url}")
    text = fetch_and_clean_url(url)
    
    chunks = chunk_text(text, max_tokens=500)
    embeddings = embed_chunks(chunks)

    db = PGVector()
    for i, (chunk, embedding) in enumerate(zip(chunks, embeddings)):
        db.insert_text(
            text=chunk,
            metadata={"source": url, "chunk_index": i},
            embedding=embedding
        )
    print(f" {len(chunks)} chunks ingested from {url}")

if __name__ == "__main__":
    url = input("Enter URL to ingest: ").strip()
    ingest_url(url)
