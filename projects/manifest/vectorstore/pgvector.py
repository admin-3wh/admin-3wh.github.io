# manifest/vectorstore/pgvector.py

import psycopg
from psycopg.rows import dict_row
from typing import List, Dict
from uuid import UUID, uuid4
import numpy as np
from datetime import datetime

class PGVectorStore:
    def __init__(self, dsn: str = "postgresql://user2:newpassword123@localhost:5432/manifest_db"):
        self.dsn = dsn
        self.conn = psycopg.connect(self.dsn, row_factory=dict_row)
        self._ensure_pgvector_extension()
        self._create_table()

    def _ensure_pgvector_extension(self):
        with self.conn.cursor() as cur:
            cur.execute("CREATE EXTENSION IF NOT EXISTS vector;")
            self.conn.commit()

    def _create_table(self):
        with self.conn.cursor() as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS documents (
                    id UUID PRIMARY KEY,
                    source TEXT,
                    chunk_index INT,
                    text TEXT,
                    embedding vector(384),
                    timestamp TIMESTAMPTZ,
                    entities JSONB
                );
            """)
            self.conn.commit()

    # Existing low‑level insert method
    def insert_documents(self, docs: List[Dict]):
        with self.conn.cursor() as cur:
            for doc in docs:
                cur.execute("""
                    INSERT INTO documents (id, source, chunk_index, text, embedding, timestamp, entities)
                    VALUES (%s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (id) DO NOTHING;
                """, (
                    UUID(doc["id"]),
                    doc["source"],
                    doc["chunk_index"],
                    doc["text"],
                    doc["embedding"],
                    doc["timestamp"],
                    doc.get("entities", [])
                ))
            self.conn.commit()

    # NEW high‑level add_documents for ingest.py
    def add_documents(self, docs: List[Dict]):
        """
        Wrapper for ingest.py. If no UUID/timestamp supplied, it will create them.
        """
        for d in docs:
            if "id" not in d:
                d["id"] = str(uuid4())
            if "timestamp" not in d:
                d["timestamp"] = datetime.utcnow()
        self.insert_documents(docs)

    def search(self, query_embedding: List[float], top_k: int = 5) -> List[Dict]:
        with self.conn.cursor() as cur:
            cur.execute("""
                SELECT id, source, chunk_index, text, embedding <-> %s::vector AS distance
                FROM documents
                ORDER BY embedding <-> %s::vector
                LIMIT %s;
            """, (
                query_embedding,
                query_embedding,
                top_k
            ))
            return cur.fetchall()
