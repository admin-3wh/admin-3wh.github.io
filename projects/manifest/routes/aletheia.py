# routes/aletheia.py

import sys
import os
from pathlib import Path
from typing import Optional

sys.path.append(
    os.path.abspath(
        os.path.join(os.path.dirname(__file__), "..")
    )
)

from fastapi import APIRouter, UploadFile, File
from pydantic import BaseModel

from sentence_transformers import SentenceTransformer

from vectorstore.pgvector import PGVectorStore
from services.llm import LLMService
from export.biomed_report_exporter import clean_report_text

from apps.aletheia.private_ingest import ingest_private_document
from apps.aletheia.reranker import retrieve_and_rerank
from apps.aletheia.document_registry import DocumentRegistry


router = APIRouter(
    prefix="/api/aletheia",
    tags=["aletheia"]
)

EMBED_MODEL = SentenceTransformer("all-MiniLM-L6-v2")
store = PGVectorStore()

UPLOAD_DIR = Path("uploads/aletheia")
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)


class QueryRequest(BaseModel):
    query: str
    top_k: int = 5
    filename: Optional[str] = None


class IngestRequest(BaseModel):
    file_path: str


class SummarizeRequest(BaseModel):
    query: str
    top_k: int = 4
    mode: str = "local"
    local_model: str = "gemma2:2b"
    filename: Optional[str] = None


def retrieve_private_chunks(
    query: str,
    top_k: int = 5,
    filename: Optional[str] = None,
):
    return retrieve_and_rerank(
        query=query,
        top_k=top_k,
        initial_k=30,
        filename=filename,
    )


def format_chunk(row: dict, preview_chars: int = 700):
    entities = row.get("entities") or {}

    text = row.get("text", "") or ""

    return {
        "id": str(row.get("id")),
        "source": row.get("source"),
        "filename": entities.get("filename"),
        "chunk_index": row.get("chunk_index"),
        "distance": row.get("distance"),
        "smart_score": row.get("_smart_score"),
        "rerank_score": row.get("_rerank_score"),
        "text_preview": (
            text[:preview_chars]
            + ("..." if len(text) > preview_chars else "")
        ),
    }


def format_document(row: dict):
    tags = row.get("tags") or []

    if not isinstance(tags, list):
        tags = []

    uploaded_at = row.get("uploaded_at")
    updated_at = row.get("updated_at")

    return {
        "id": row.get("id"),
        "app": row.get("app"),
        "filename": row.get("filename"),
        "file_path": row.get("file_path"),
        "extension": row.get("extension"),
        "file_hash": row.get("file_hash"),
        "document_type": row.get("document_type"),
        "source": row.get("source"),
        "author": row.get("author"),
        "language": row.get("language") or "unknown",
        "tags": tags,
        "summary": row.get("summary"),
        "text_length": row.get("text_length") or 0,
        "chunks_created": row.get("chunks_created") or 0,
        "uploaded_at": str(uploaded_at) if uploaded_at else None,
        "updated_at": str(updated_at) if updated_at else None,
    }


def build_prompt(
    query: str,
    chunks,
    filename: Optional[str] = None,
):
    blocks = []

    for idx, row in enumerate(chunks, 1):
        entities = row.get("entities") or {}

        blocks.append(
            f"""
DOCUMENT {idx}
Filename: {entities.get("filename")}
Chunk: {row.get("chunk_index")}
Vector Distance: {row.get("distance")}
Smart Score: {row.get("_smart_score")}
Rerank Score: {row.get("_rerank_score")}

Text:
{row.get("text", "")[:1800]}
"""
        )

    joined = "\n\n".join(blocks)

    scope_text = (
        f"Document scope: only use {filename}."
        if filename
        else "Document scope: use all relevant private documents."
    )

    return f"""
You are Aletheia.

Aletheia is a private intelligence system.

Use ONLY the supplied evidence.

Do not invent claims.

{scope_text}

User query:
{query}

Write:

1. Direct Answer
2. Key Findings
3. Supporting Evidence
4. Uncertainty / Missing Information
5. Relevant Documents

PRIVATE DOCUMENT EVIDENCE:
{joined}
"""


@router.get("/health")
def health():
    return {
        "status": "ok",
        "service": "Aletheia Private Intelligence API"
    }


@router.get("/documents")
def list_documents():
    registry = DocumentRegistry()

    try:
        docs = registry.list_documents(app="aletheia")

        return {
            "count": len(docs),
            "documents": [
                format_document(doc)
                for doc in docs
            ]
        }

    finally:
        registry.close()


@router.post("/upload")
async def upload_document(file: UploadFile = File(...)):
    suffix = Path(file.filename).suffix.lower()

    if suffix not in {".txt", ".md", ".pdf"}:
        return {
            "status": "rejected",
            "reason": f"Unsupported file type: {suffix}"
        }

    safe_name = Path(file.filename).name
    destination = UPLOAD_DIR / safe_name

    content = await file.read()
    destination.write_bytes(content)

    result = ingest_private_document(str(destination))

    return {
        "status": "uploaded_and_ingested",
        "filename": safe_name,
        "path": str(destination),
        "result": result
    }


@router.post("/ingest")
def ingest_document(request: IngestRequest):
    result = ingest_private_document(
        request.file_path
    )

    return {
        "status": "completed",
        "result": result
    }


@router.post("/query")
def query_documents(request: QueryRequest):
    results = retrieve_private_chunks(
        query=request.query,
        top_k=request.top_k,
        filename=request.filename,
    )

    formatted = [
        format_chunk(r)
        for r in results
    ]

    return {
        "query": request.query,
        "filename": request.filename,
        "count": len(formatted),
        "results": formatted
    }


@router.post("/summarize")
def summarize_documents(request: SummarizeRequest):
    chunks = retrieve_private_chunks(
        query=request.query,
        top_k=request.top_k,
        filename=request.filename,
    )

    if not chunks:
        return {
            "query": request.query,
            "filename": request.filename,
            "report": "No relevant private documents found.",
            "evidence": []
        }

    prompt = build_prompt(
        query=request.query,
        chunks=chunks,
        filename=request.filename,
    )

    llm = LLMService(
        mode=request.mode,
        local_model=request.local_model
    )

    output = clean_report_text(
        llm.generate(prompt)
    )

    return {
        "query": request.query,
        "filename": request.filename,
        "mode": request.mode,
        "local_model": request.local_model,
        "chunks_used": len(chunks),
        "report": output,
        "evidence": [
            format_chunk(c)
            for c in chunks
        ]
    }
