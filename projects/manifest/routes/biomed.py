# routes/biomed.py

import sys
import os

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from fastapi import APIRouter
from pydantic import BaseModel

from sentence_transformers import SentenceTransformer

from vectorstore.pgvector import PGVectorStore
from scripts.biomed_ingest import ingest_biomed_url
from scripts.biomed_discover import discover
from services.llm import LLMService
from services.biomed_synthesis import compress_context, build_clean_biomed_prompt


router = APIRouter(prefix="/api/biomed", tags=["biomed"])

model = SentenceTransformer("all-MiniLM-L6-v2")
store = PGVectorStore()


class QueryRequest(BaseModel):
    query: str
    top_k: int = 10


class IngestRequest(BaseModel):
    url: str


class DiscoverRequest(BaseModel):
    query: str
    max_results: int = 5
    auto_ingest: bool = False


class SummarizeRequest(BaseModel):
    query: str
    mode: str = "fallback"  # fallback, local, openai
    local_model: str = "gemma2:2b"
    top_k: int = 4


def retrieve_biomed_chunks(query: str, top_k: int = 10):
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


def format_chunk(row: dict, preview_chars: int = 900):
    entities = row.get("entities") or {}

    title = ""
    topics = []

    if isinstance(entities, dict):
        title = entities.get("title", "")
        topics = entities.get("topics", [])

    text = row.get("text", "") or ""

    return {
        "id": str(row.get("id")),
        "source": row.get("source"),
        "title": title,
        "chunk_index": row.get("chunk_index"),
        "distance": row.get("distance"),
        "topics": topics[:12],
        "text_preview": text[:preview_chars] + ("..." if len(text) > preview_chars else ""),
    }


def format_chunks(rows, preview_chars: int = 900):
    return [format_chunk(row, preview_chars=preview_chars) for row in rows]


@router.get("/health")
def health():
    return {
        "status": "ok",
        "service": "Manifest Biomedical API"
    }


@router.post("/query")
def biomed_query(request: QueryRequest):
    results = retrieve_biomed_chunks(
        query=request.query,
        top_k=request.top_k
    )

    formatted = format_chunks(results)

    return {
        "query": request.query,
        "count": len(formatted),
        "results": formatted
    }


@router.post("/ingest")
def biomed_ingest(request: IngestRequest):
    ingest_biomed_url(request.url)

    return {
        "status": "completed",
        "url": request.url
    }


@router.post("/discover")
def biomed_discover(request: DiscoverRequest):
    accepted = discover(
        query=request.query,
        max_results=request.max_results,
        auto_ingest=request.auto_ingest
    )

    clean_accepted = []

    for item in accepted:
        article = item.get("article", {})
        score = item.get("score", {})

        clean_accepted.append({
            "title": article.get("title"),
            "year": article.get("year"),
            "journal": article.get("journal"),
            "pmid": article.get("pmid"),
            "pmcid": article.get("pmcid"),
            "pubmed_url": article.get("pubmed_url"),
            "pmc_url": article.get("pmc_url"),
            "topics": score.get("topics", []),
            "accepted": score.get("accepted"),
            "reason": score.get("reason"),
            "text_length": score.get("text_length"),
            "chunk_count": score.get("chunk_count"),
        })

    return {
        "query": request.query,
        "accepted_count": len(clean_accepted),
        "accepted": clean_accepted
    }


@router.post("/summarize")
def biomed_summarize(request: SummarizeRequest):
    chunks = retrieve_biomed_chunks(
        query=request.query,
        top_k=request.top_k
    )

    if request.mode == "fallback":
        return {
            "query": request.query,
            "mode": "fallback",
            "chunks_used": len(chunks),
            "chunks": format_chunks(chunks)
        }

    compressed_chunks = compress_context(chunks, max_chunks=request.top_k)
    prompt = build_clean_biomed_prompt(request.query, compressed_chunks)

    llm = LLMService(
        mode=request.mode,
        local_model=request.local_model
    )

    output = llm.generate(prompt)

    return {
        "query": request.query,
        "mode": request.mode,
        "local_model": request.local_model,
        "chunks_used": len(chunks),
        "report": output,
        "evidence": format_chunks(chunks, preview_chars=500)
    }
