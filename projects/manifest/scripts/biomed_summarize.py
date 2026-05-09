# scripts/biomed_summarize.py

import sys
import os
from collections import defaultdict

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from sentence_transformers import SentenceTransformer
from vectorstore.pgvector import PGVectorStore

model = SentenceTransformer("all-MiniLM-L6-v2")
store = PGVectorStore()


def retrieve_biomed_chunks(query: str, top_k: int = 12):
    query_embedding = model.encode(query).tolist()
    results = store.search(query_embedding, top_k=top_k)

    biomed_results = []

    for row in results:
        entities = row.get("entities") or {}
        source = row.get("source", "")

        if isinstance(entities, dict) and entities.get("app") == "biomed":
            biomed_results.append(row)
        elif "ncbi.nlm.nih.gov" in source or "pmc.ncbi.nlm.nih.gov" in source:
            biomed_results.append(row)

    return biomed_results


def collect_topics(results):
    topic_counts = defaultdict(int)

    for row in results:
        entities = row.get("entities") or {}

        if isinstance(entities, dict):
            for topic in entities.get("topics", []):
                topic_counts[topic] += 1

        elif isinstance(entities, list):
            for topic in entities:
                topic_counts[topic] += 1

    return sorted(topic_counts.items(), key=lambda x: x[1], reverse=True)


def group_by_source(results):
    grouped = defaultdict(list)

    for row in results:
        grouped[row.get("source", "Unknown source")].append(row)

    return grouped


def print_research_brief(query: str, results):
    print("\n" + "=" * 80)
    print("MANIFEST BIOMED RESEARCH BRIEF")
    print("=" * 80)

    print(f"\nQuery:\n{query}")

    if not results:
        print("\nNo biomedical results found.")
        return

    topics = collect_topics(results)
    grouped = group_by_source(results)

    print("\nCore Detected Topics:")
    print("-" * 80)

    if topics:
        for topic, count in topics[:12]:
            print(f"- {topic} ({count} chunks)")
    else:
        print("- No structured topics found.")

    print("\nHigh-Level Summary:")
    print("-" * 80)

    top_texts = [row.get("text", "") for row in results[:5]]
    combined_preview = " ".join(top_texts)

    print(combined_preview[:1600] + ("..." if len(combined_preview) > 1600 else ""))

    print("\nPotential Mechanisms / Signals:")
    print("-" * 80)

    mechanism_keywords = [
        "inflammation",
        "cytokine",
        "senescence",
        "immune",
        "oxidative stress",
        "mitochondria",
        "homeostasis",
        "frailty",
        "cardiovascular",
        "NLRP3",
        "IL-6",
        "TNF",
        "SPLA2",
        "PLA2G1B",
    ]

    found_mechanisms = set()

    for row in results:
        text_lower = row.get("text", "").lower()

        for keyword in mechanism_keywords:
            if keyword.lower() in text_lower:
                found_mechanisms.add(keyword)

    if found_mechanisms:
        for item in sorted(found_mechanisms):
            print(f"- {item}")
    else:
        print("- No obvious mechanism keywords found in retrieved chunks.")

    print("\nSource-Based Evidence:")
    print("-" * 80)

    for source, rows in grouped.items():
        print(f"\nSource: {source}")
        print(f"Retrieved chunks: {len(rows)}")

        title = None
        first_entities = rows[0].get("entities") or {}

        if isinstance(first_entities, dict):
            title = first_entities.get("title")

        if title:
            print(f"Title: {title}")

        for row in rows[:3]:
            print(f"\n  Chunk {row.get('chunk_index')}")
            print(f"  Distance: {row.get('distance')}")
            print(f"  Text: {row.get('text', '')[:700]}...")

    print("\nLimitations:")
    print("-" * 80)
    print("- This is retrieval-based summarization, not full LLM synthesis yet.")
    print("- It does not currently judge study quality, causal strength, or contradictions.")
    print("- It only summarizes documents already ingested into Manifest.")
    print("- Next upgrade: LLM-assisted synthesis with citations and evidence grading.")


def run():
    print("Manifest Biomedical Summarizer")

    while True:
        query = input("\nEnter biomedical research query (or 'exit'): ").strip()

        if query.lower() == "exit":
            break

        results = retrieve_biomed_chunks(query, top_k=15)
        print_research_brief(query, results)


if __name__ == "__main__":
    run()
