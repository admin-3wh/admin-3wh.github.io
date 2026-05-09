# scripts/biomed_query.py

import sys
import os

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from sentence_transformers import SentenceTransformer
from vectorstore.pgvector import PGVectorStore

model = SentenceTransformer("all-MiniLM-L6-v2")
store = PGVectorStore()


def search_biomed(query: str, top_k: int = 7):
    query_embedding = model.encode(query).tolist()
    results = store.search(query_embedding, top_k=top_k)

    biomed_results = []

    for row in results:
        entities = row.get("entities")

        if isinstance(entities, dict) and entities.get("app") == "biomed":
            biomed_results.append(row)

    return biomed_results


def run():
    print("Manifest Biomedical Query")

    while True:
        query = input("\nEnter biomedical query (or 'exit'): ").strip()

        if query.lower() == "exit":
            break

        results = search_biomed(query)

        if not results:
            print("\nNo biomedical results found.")
            continue

        print("\nTop Biomedical Results:")

        for i, row in enumerate(results, 1):
            entities = row.get("entities", {})
            topics = entities.get("topics", []) if isinstance(entities, dict) else []

            print(f"\n[{i}] Source: {row.get('source')}")
            print(f"    Chunk: {row.get('chunk_index')}")
            print(f"    Topics: {topics}")
            print(f"    Distance: {row.get('distance')}")
            print(f"    Text: {row.get('text', '')[:700]}...")


if __name__ == "__main__":
    run()
