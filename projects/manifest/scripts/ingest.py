# scripts/ingest.py

import os
from dotenv import load_dotenv
from vectorstore.pgvector import PGVectorStore
from sentence_transformers import SentenceTransformer
from uuid import uuid4

load_dotenv()

# You can swap in OpenAI or keep this fast local model for now
EMBEDDING_MODEL = SentenceTransformer("all-MiniLM-L6-v2")

store = PGVectorStore()

def ingest_text(title: str, text: str):
    # Chunking (can be made more advanced)
    chunks = [text[i:i+500] for i in range(0, len(text), 500)]
    embeddings = EMBEDDING_MODEL.encode(chunks)

    documents = [
        {
            "id": str(uuid4()),
            "content": chunk,
            "embedding": embedding.tolist(),
            "metadata": {"source": title}
        }
        for chunk, embedding in zip(chunks, embeddings)
    ]

    store.add_documents(documents)
    print(f"Ingested {len(documents)} chunks from '{title}'.")

if __name__ == "__main__":
    sample_text = "Manifest is a modular AI-powered web crawler and intelligence system."
    ingest_text("Sample Source", sample_text)
