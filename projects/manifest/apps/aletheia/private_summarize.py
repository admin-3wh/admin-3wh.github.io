# apps/aletheia/private_summarize.py

import sys
import os

sys.path.append(
    os.path.abspath(
        os.path.join(os.path.dirname(__file__), "../..")
    )
)

from sentence_transformers import SentenceTransformer

from vectorstore.pgvector import PGVectorStore
from services.llm import LLMService


EMBED_MODEL = SentenceTransformer("all-MiniLM-L6-v2")
store = PGVectorStore()


def retrieve_private_chunks(query: str, top_k: int = 4):
    query_embedding = EMBED_MODEL.encode(query).tolist()

    results = store.search(
        query_embedding,
        top_k=top_k
    )

    private_results = []

    for row in results:
        entities = row.get("entities") or {}

        if (
            isinstance(entities, dict)
            and entities.get("app") == "aletheia"
        ):
            private_results.append(row)

    return private_results


def build_prompt(query: str, chunks):
    source_blocks = []

    for idx, row in enumerate(chunks, 1):
        entities = row.get("entities") or {}

        filename = entities.get("filename", "Unknown file")

        source_blocks.append(
            f"""
DOCUMENT {idx}
Filename: {filename}
Chunk: {row.get("chunk_index")}

Text:
{row.get("text", "")[:1800]}
"""
        )

    joined_sources = "\n\n".join(source_blocks)

    return f"""
You are Aletheia.

Aletheia is a private document intelligence system.

Use ONLY the supplied private document evidence.

Do not invent information.

User query:
{query}

Write:

1. Direct Answer
2. Key Findings
3. Supporting Evidence
4. Uncertainty / Missing Information
5. Relevant Documents

PRIVATE DOCUMENT EVIDENCE:
{joined_sources}
"""


if __name__ == "__main__":
    print("Aletheia Private Summarizer")

    llm = LLMService(
        mode="local",
        local_model="gemma2:2b"
    )

    while True:
        query = input(
            "\nEnter private intelligence query (or 'exit'): "
        ).strip()

        if query.lower() == "exit":
            break

        chunks = retrieve_private_chunks(query)

        if not chunks:
            print("\nNo private document evidence found.")
            continue

        prompt = build_prompt(query, chunks)

        print("\nGenerating synthesis...\n")

        output = llm.generate(prompt)

        print("=" * 80)
        print("ALETHEIA PRIVATE INTELLIGENCE BRIEF")
        print("=" * 80)

        print(output)
