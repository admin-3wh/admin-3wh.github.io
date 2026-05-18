# apps/aletheia/reranker.py

import sys
import os
from pathlib import Path
from typing import List, Optional

sys.path.append(
    os.path.abspath(
        os.path.join(os.path.dirname(__file__), "../..")
    )
)

from sentence_transformers import CrossEncoder

from apps.aletheia.retriever import retrieve_private_chunks_smart


RERANKER_MODEL_NAME = "cross-encoder/ms-marco-MiniLM-L-6-v2"

reranker_model = CrossEncoder(RERANKER_MODEL_NAME)


def get_filename(row: dict) -> str:
    entities = row.get("entities") or {}

    if isinstance(entities, dict) and entities.get("filename"):
        return entities.get("filename")

    source = row.get("source") or ""

    return Path(source).name or "unknown"


def rerank_chunks(
    query: str,
    chunks: List[dict],
    top_k: int = 5,
) -> List[dict]:
    """
    Cross-encoder reranking.

    Vector retrieval finds candidate chunks.
    Reranker scores query + chunk pairs more precisely.
    """

    if not chunks:
        return []

    pairs = []

    for row in chunks:
        text = row.get("text", "") or ""
        pairs.append((query, text[:3000]))

    scores = reranker_model.predict(pairs)

    ranked = []

    for row, score in zip(chunks, scores):
        row["_rerank_score"] = float(score)
        ranked.append(row)

    ranked = sorted(
        ranked,
        key=lambda r: r.get("_rerank_score", 0),
        reverse=True
    )

    return ranked[:top_k]


def retrieve_and_rerank(
    query: str,
    top_k: int = 5,
    initial_k: int = 30,
    filename: Optional[str] = None,
) -> List[dict]:
    """
    Full Aletheia retrieval pipeline:

    query
    -> broad vector retrieval
    -> optional filename filtering
    -> cross-encoder reranking
    -> best evidence chunks
    """

    candidates = retrieve_private_chunks_smart(
        query=query,
        top_k=initial_k,
        initial_k=initial_k,
        max_chunks_per_document=5,
    )

    if filename:
        candidates = [
            row for row in candidates
            if get_filename(row) == filename
        ]

    reranked = rerank_chunks(
        query=query,
        chunks=candidates,
        top_k=top_k,
    )

    return reranked


if __name__ == "__main__":
    print("Aletheia Cross-Encoder Reranker")
    print(f"Model: {RERANKER_MODEL_NAME}")

    while True:
        query = input("\nEnter query (or 'exit'): ").strip()

        if query.lower() == "exit":
            break

        filename = input(
            "Optional filename scope, or press Enter for all docs: "
        ).strip()

        if not filename:
            filename = None

        results = retrieve_and_rerank(
            query=query,
            top_k=5,
            initial_k=30,
            filename=filename,
        )

        if not results:
            print("\nNo reranked results found.")
            continue

        print("\nReranked Results")
        print("-" * 70)

        for idx, row in enumerate(results, 1):
            print(f"\n[{idx}] {get_filename(row)}")
            print(f"Source: {row.get('source')}")
            print(f"Chunk: {row.get('chunk_index')}")
            print(f"Vector Distance: {row.get('distance')}")
            print(f"Smart Score: {row.get('_smart_score')}")
            print(f"Rerank Score: {row.get('_rerank_score')}")
            print(f"Text: {row.get('text', '')[:700]}...")
