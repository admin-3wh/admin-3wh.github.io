# services/biomed_synthesis.py

from collections import defaultdict


MECHANISM_TERMS = [
    "inflammation", "inflammaging", "inflammageing", "cytokine", "cytokines",
    "IL-6", "TNF", "NLRP3", "NF-κB", "NF-kB", "oxidative stress",
    "mitochondria", "mitochondrial dysfunction", "cellular senescence",
    "SASP", "immune", "immune response", "homeostasis", "frailty",
    "cardiovascular", "autophagy", "nutrient sensing", "catabolism",
    "growth factors", "insulin resistance", "dysbiosis"
]


def rerank_chunks(chunks, max_per_source=3):
    """
    Keep strongest chunks while preventing one source from dominating.
    Lower vector distance = better match.
    """
    grouped = defaultdict(list)

    for chunk in sorted(chunks, key=lambda r: r.get("distance", 999)):
        grouped[chunk.get("source", "unknown")].append(chunk)

    reranked = []

    for source, rows in grouped.items():
        reranked.extend(rows[:max_per_source])

    return sorted(reranked, key=lambda r: r.get("distance", 999))


def extract_mechanisms(text):
    found = []

    lower = text.lower()

    for term in MECHANISM_TERMS:
        if term.lower() in lower:
            found.append(term)

    return sorted(set(found))


def compress_chunk(row, max_chars=900):
    entities = row.get("entities") or {}

    title = ""
    topics = []

    if isinstance(entities, dict):
        title = entities.get("title", "")
        topics = entities.get("topics", [])

    text = row.get("text", "")
    mechanisms = extract_mechanisms(text)

    return {
        "title": title,
        "source": row.get("source"),
        "chunk_index": row.get("chunk_index"),
        "distance": row.get("distance"),
        "topics": topics[:8],
        "mechanisms": mechanisms,
        "text": text[:max_chars],
    }


def compress_context(chunks, max_chunks=6):
    reranked = rerank_chunks(chunks)
    selected = reranked[:max_chunks]

    return [compress_chunk(row) for row in selected]


def build_clean_biomed_prompt(query, compressed_chunks):
    source_blocks = []

    for i, chunk in enumerate(compressed_chunks, 1):
        source_blocks.append(
            f"""
[SOURCE {i}]
Title: {chunk["title"]}
URL: {chunk["source"]}
Chunk: {chunk["chunk_index"]}
Distance: {chunk["distance"]}
Topics: {", ".join(chunk["topics"])}
Mechanism terms detected: {", ".join(chunk["mechanisms"])}

Evidence text:
{chunk["text"]}
"""
        )

    return f"""
You are Manifest, a biomedical research intelligence engine.

Answer the research question using ONLY the supplied evidence sources.

Research question:
{query}

Rules:
- Do not invent claims.
- If evidence is limited, say so.
- Distinguish established findings from uncertainty.
- Mention source numbers like [SOURCE 1], [SOURCE 2].
- Keep the writing clean and professional.
- Do not create malformed markdown links.
- Do not repeat words.

Write the report with these sections:

# Direct Answer
# Mechanism Map
# Evidence From Sources
# What Seems Established
# What Remains Uncertain
# Research Gaps / Next Questions
# Source Notes

Evidence sources:
{"".join(source_blocks)}
"""
