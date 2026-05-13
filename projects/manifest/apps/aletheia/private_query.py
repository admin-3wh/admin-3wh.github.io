# apps/aletheia/private_query.py

import sys
import os

sys.path.append(
    os.path.abspath(
        os.path.join(os.path.dirname(__file__), "../..")
    )
)

from sentence_transformers import SentenceTransformer
from vectorstore.pgvector import PGVectorStore


EMBED_MODEL = SentenceTransformer("all-MiniLM-L6-v2")
store = PGVectorStore()


def query_private_documents(query: str, top_k: int = 5):
    query_embedding = EMBED_MODEL.encode(query).tolist()
    results = store.search(query_embedding, top_k=top_k)

    private_results = []

    for row in results:
        entities = row.get("entities") or {}

        if isinstance(entities, dict) and entities.get("app") == "aletheia":
            private_results.append(row)

    return private_results


if __name__ == "__main__":
    print("Aletheia Private Query")

    while True:
        query = input("\nEnter private document query (or 'exit'): ").strip()

        if query.lower() == "exit":
            break

        results = query_private_documents(query)

        if not results:
            print("\nNo private document results found.")
            continue

        print("\nTop Private Results")
        print("-" * 50)

        for idx, row in enumerate(results, 1):
            entities = row.get("entities") or {}

            print(f"\n[{idx}] {entities.get('filename', 'Unknown file')}")
            print(f"Source: {row.get('source')}")
            print(f"Chunk: {row.get('chunk_index')}")
            print(f"Distance: {row.get('distance')}")
            print(f"Text: {row.get('text', '')[:800]}...")
