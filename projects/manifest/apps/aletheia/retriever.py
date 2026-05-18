# apps/aletheia/retriever.py

import sys
import os
from collections import defaultdict
from pathlib import Path

sys.path.append(
    os.path.abspath(
        os.path.join(os.path.dirname(__file__), "../..")
    )
)

from sentence_transformers import SentenceTransformer
from vectorstore.pgvector import PGVectorStore


EMBED_MODEL = SentenceTransformer("all-MiniLM-L6-v2")
store = PGVectorStore()


def _filename_from_row(row: dict) -> str:
    entities = row.get("entities") or {}

    if isinstance(entities, dict):
        filename = entities.get("filename")
        if filename:
            return filename

    source = row.get("source", "") or ""
    return Path(source).name or "unknown"


def _query_mentions_filename(query: str, filename: str) -> bool:
    q = query.lower()
    f = filename.lower()

    stem = Path(filename).stem.lower()

    return (
        f in q
        or stem in q
        or stem.replace("-", " ") in q
        or stem.replace("_", " ") in q
    )


def _score_row(row: dict, query: str) -> float:
    """
    Lower score is better.

    Base score is vector distance.
    Then we apply small boosts for filename/source matches.
    """
    distance = float(row.get("distance") or 999)
    filename = _filename_from_row(row)

    score = distance

    if _query_mentions_filename(query, filename):
        score -= 0.25

    source = (row.get("source") or "").lower()
    if source and source in query.lower():
        score -= 0.15

    return score


def retrieve_private_chunks_smart(
    query: str,
    top_k: int = 6,
    initial_k: int = 30,
    max_chunks_per_document: int = 3,
):
    """
    Smarter Aletheia retrieval.

    Goals:
    - search broadly first
    - filter to Aletheia docs
    - group by document
    - prevent one document from dominating
    - boost explicit filename/source matches
    - return diverse evidence across docs
    """

    query_embedding = EMBED_MODEL.encode(query).tolist()

    raw_results = store.search(
        query_embedding,
        top_k=initial_k
    )

    private_rows = []

    for row in raw_results:
        entities = row.get("entities") or {}

        if (
            isinstance(entities, dict)
            and entities.get("app") == "aletheia"
        ):
            row["_filename"] = _filename_from_row(row)
            row["_smart_score"] = _score_row(row, query)
            private_rows.append(row)

    grouped = defaultdict(list)

    for row in private_rows:
        grouped[row["_filename"]].append(row)

    selected = []

    # First pass: take strongest chunks per document
    for filename, rows in grouped.items():
        sorted_rows = sorted(
            rows,
            key=lambda r: r.get("_smart_score", 999)
        )

        selected.extend(
            sorted_rows[:max_chunks_per_document]
        )

    selected = sorted(
        selected,
        key=lambda r: r.get("_smart_score", 999)
    )

    return selected[:top_k]


if __name__ == "__main__":
    print("Aletheia Smart Retriever")

    while True:
        query = input("\nEnter query (or 'exit'): ").strip()

        if query.lower() == "exit":
            break

        results = retrieve_private_chunks_smart(query)

        if not results:
            print("\nNo results.")
            continue

        print("\nSmart Retrieval Results")
        print("-" * 60)

        for i, row in enumerate(results, 1):
            print(f"\n[{i}] {_filename_from_row(row)}")
            print(f"Source: {row.get('source')}")
            print(f"Chunk: {row.get('chunk_index')}")
            print(f"Distance: {row.get('distance')}")
            print(f"Smart Score: {row.get('_smart_score')}")
            print(f"Text: {row.get('text', '')[:500]}...")
