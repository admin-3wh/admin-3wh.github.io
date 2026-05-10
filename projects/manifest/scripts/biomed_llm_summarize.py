# scripts/biomed_llm_summarize.py

import sys
import os
import argparse

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from sentence_transformers import SentenceTransformer

from vectorstore.pgvector import PGVectorStore
from services.llm import LLMService
from export.biomed_report_exporter import save_markdown_report
from services.biomed_synthesis import compress_context, build_clean_biomed_prompt


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


def build_prompt(query: str, chunks):
    source_blocks = []

    for i, row in enumerate(chunks, 1):
        entities = row.get("entities") or {}

        title = ""
        if isinstance(entities, dict):
            title = entities.get("title", "")

        source_blocks.append(
            f"""
SOURCE CHUNK {i}
Title: {title}
Source: {row.get("source")}
Chunk: {row.get("chunk_index")}
Distance: {row.get("distance")}

Text:
{row.get("text", "")[:1800]}
"""
        )

    sources_text = "\n\n".join(source_blocks)

    return f"""
You are Manifest, a biomedical research synthesis engine.

User research question:
{query}

Use ONLY the source chunks below. Do not invent claims.

Write a structured research brief with these sections:

1. Direct Answer
2. Mechanism Map
3. Evidence From Sources
4. What Seems Established
5. What Remains Uncertain
6. Research Gaps / Next Questions
7. Source Notes

Source chunks:
{sources_text}
"""


def build_fallback_text(query: str, chunks):
    lines = []

    lines.append("# Manifest Local Structured Brief")
    lines.append("")
    lines.append(f"## Query")
    lines.append(query)
    lines.append("")

    if not chunks:
        lines.append("No biomedical chunks found.")
        return "\n".join(lines)

    lines.append("## Retrieved Evidence Chunks")
    lines.append("")

    for i, row in enumerate(chunks, 1):
        entities = row.get("entities") or {}
        title = entities.get("title", "") if isinstance(entities, dict) else ""

        lines.append(f"### [{i}] {title}")
        lines.append(f"- **Source:** {row.get('source')}")
        lines.append(f"- **Chunk:** {row.get('chunk_index')}")
        lines.append(f"- **Distance:** {row.get('distance')}")
        lines.append("")
        lines.append(row.get("text", "")[:900] + "...")
        lines.append("")

    lines.append("## Note")
    lines.append("This is local fallback mode. Install Ollama or enable OpenAI mode for true synthesis.")

    return "\n".join(lines)


def local_structured_fallback(query: str, chunks):
    output = build_fallback_text(query, chunks)

    print("\n" + "=" * 80)
    print("MANIFEST LOCAL STRUCTURED BRIEF")
    print("=" * 80)
    print(output)

    return output


def maybe_save_report(query: str, output: str, mode: str, local_model: str, top_k: int, chunks):
    save_choice = input("\nSave report to Markdown? [y/N]: ").strip().lower()

    if save_choice == "y":
        path = save_markdown_report(
            query=query,
            report_text=output,
            mode=mode,
            metadata={
                "local_model": local_model,
                "top_k": top_k,
                "chunks_used": len(chunks),
            },
        )

        print(f"\nSaved report to: {path}")


def run(mode: str, local_model: str, top_k: int):
    print(f"Manifest Biomedical LLM Summarizer [{mode}]")

    while True:
        query = input("\nEnter biomedical research query (or 'exit'): ").strip()

        if query.lower() == "exit":
            break

        chunks = retrieve_biomed_chunks(query, top_k=top_k)

        if mode == "fallback":
            output = local_structured_fallback(query, chunks)
            maybe_save_report(query, output, mode, local_model, top_k, chunks)
            continue

        compressed_chunks = compress_context(chunks, max_chunks=top_k)
        prompt = build_clean_biomed_prompt(query, compressed_chunks)
        llm = LLMService(mode=mode, local_model=local_model)

        output = llm.generate(prompt)

        print("\n" + "=" * 80)
        print("MANIFEST SYNTHESIZED RESEARCH BRIEF")
        print("=" * 80)
        print(output)

        maybe_save_report(query, output, mode, local_model, top_k, chunks)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()

    parser.add_argument(
        "--mode",
        choices=["fallback", "local", "openai"],
        default="fallback",
        help="fallback = no LLM, local = Ollama, openai = OpenAI API",
    )

    parser.add_argument(
        "--local-model",
        default="mistral",
        help="Ollama model name for local mode",
    )

    parser.add_argument(
        "--top-k",
        type=int,
        default=12,
        help="Number of retrieved chunks to include",
    )

    args = parser.parse_args()

    run(
        mode=args.mode,
        local_model=args.local_model,
        top_k=args.top_k,
    )
