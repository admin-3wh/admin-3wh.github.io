# apps/aletheia/private_ingest.py

import sys
import os

sys.path.append(
    os.path.abspath(
        os.path.join(os.path.dirname(__file__), "../..")
    )
)

from uuid import uuid4
from datetime import datetime, UTC

from sentence_transformers import SentenceTransformer

from apps.aletheia.private_extract import extract_document
from vectorstore.pgvector import PGVectorStore


EMBED_MODEL = SentenceTransformer("all-MiniLM-L6-v2")

store = PGVectorStore()


def chunk_text(text: str, chunk_size: int = 500):
    words = text.split()

    chunks = []

    for i in range(0, len(words), chunk_size):
        chunk = " ".join(words[i:i + chunk_size])

        if chunk.strip():
            chunks.append(chunk)

    return chunks


def ingest_private_document(file_path: str):
    extracted = extract_document(file_path)

    text = extracted["text"]

    chunks = chunk_text(text)

    docs = []

    for idx, chunk in enumerate(chunks):
        embedding = EMBED_MODEL.encode(chunk).tolist()

        docs.append({
            "id": str(uuid4()),
            "source": extracted["path"],
            "chunk_index": idx,
            "text": chunk,
            "embedding": embedding,
            "timestamp": datetime.now(UTC),
            "entities": {
                "app": "aletheia",
                "filename": extracted["filename"],
                "extension": extracted["extension"],
            }
        })

    store.add_documents(docs)

    return {
        "filename": extracted["filename"],
        "chunks_created": len(docs),
        "text_length": extracted["text_length"],
    }


if __name__ == "__main__":
    print("Aletheia Private Ingest")

    file_path = input("\nEnter file path: ").strip()

    result = ingest_private_document(file_path)

    print("\nIngestion Complete")
    print("-" * 50)

    print(f"Filename: {result['filename']}")
    print(f"Text length: {result['text_length']}")
    print(f"Chunks created: {result['chunks_created']}")
