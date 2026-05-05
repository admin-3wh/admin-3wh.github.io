# scripts/summarize.py

from sentence_transformers import SentenceTransformer
from vectorstore.pgvector import PGVectorStore

model = SentenceTransformer("all-MiniLM-L6-v2")
store = PGVectorStore()


def retrieve_chunks(query: str, top_k: int = 5):
    query_embedding = model.encode(query).tolist()
    results = store.search(query_embedding, top_k=top_k)

    # Remove duplicate text chunks
    seen = set()
    unique_results = []

    for row in results:
        text = row.get("text", "").strip()
        if text and text not in seen:
            seen.add(text)
            unique_results.append(row)

    return unique_results


def summarize_results(query: str, results):
    if not results:
        return "No relevant results found."

    print("\nMANIFEST SUMMARY")
    print("=" * 60)
    print(f"Query: {query}")
    print("=" * 60)

    print("\nShort Answer:")
    top_text = results[0].get("text", "")
    print(top_text[:700] + ("..." if len(top_text) > 700 else ""))

    print("\nKey Source Chunks:")
    for i, row in enumerate(results, 1):
        source = row.get("source", "Unknown source")
        chunk_index = row.get("chunk_index", "N/A")
        text = row.get("text", "")

        print(f"\n[{i}] Source: {source}")
        print(f"    Chunk: {chunk_index}")
        print(f"    Text: {text[:500]}{'...' if len(text) > 500 else ''}")

    print("\nSources Used:")
    for row in results:
        print(f"- {row.get('source', 'Unknown source')}")


def run():
    print("Manifest Summarizer")

    while True:
        query = input("\nEnter query to summarize (or 'exit'): ").strip()

        if query.lower() == "exit":
            break

        results = retrieve_chunks(query, top_k=7)
        summarize_results(query, results)


if __name__ == "__main__":
    run()
