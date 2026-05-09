# manifest/vectorstore/pgvector.py

import psycopg
from psycopg.rows import dict_row
from typing import List, Dict
from uuid import UUID, uuid4
from datetime import datetime, UTC
from psycopg.types.json import Jsonb


class PGVectorStore:
    def __init__(self, dsn: str = "postgresql://user2:newpassword123@localhost:5432/manifest_db"):
        self.dsn = dsn
        self.conn = psycopg.connect(self.dsn, row_factory=dict_row)
        self._ensure_pgvector_extension()
        self._create_table()
        self._ensure_indexes()

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

    def _ensure_indexes(self):
        """
        Create indexes for source lookup and duplicate prevention.

        NOTE:
        The unique index may fail if duplicate source/chunk_index rows
        already exist. If that happens, run the duplicate cleanup SQL first.
        """
        with self.conn.cursor() as cur:
            cur.execute("""
                CREATE INDEX IF NOT EXISTS idx_documents_source
                ON documents (source);
            """)

            cur.execute("""
                CREATE UNIQUE INDEX IF NOT EXISTS idx_documents_source_chunk
                ON documents (source, chunk_index);
            """)

            self.conn.commit()

    def insert_documents(self, docs: List[Dict]):
        with self.conn.cursor() as cur:
            for doc in docs:
                cur.execute("""
                    INSERT INTO documents (
                        id,
                        source,
                        chunk_index,
                        text,
                        embedding,
                        timestamp,
                        entities
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (source, chunk_index) DO NOTHING;
                """, (
                    UUID(doc["id"]),
                    doc["source"],
                    doc["chunk_index"],
                    doc["text"],
                    doc["embedding"],
                    doc["timestamp"],
                    Jsonb(doc.get("entities", []))
                ))

            self.conn.commit()

    def add_documents(self, docs: List[Dict]):
        """
        High-level insert wrapper.

        If no UUID/timestamp is supplied, it creates them.
        """
        for doc in docs:
            if "id" not in doc:
                doc["id"] = str(uuid4())

            if "timestamp" not in doc:
                doc["timestamp"] = datetime.now(UTC)

        self.insert_documents(docs)

    def search(self, query_embedding: List[float], top_k: int = 5) -> List[Dict]:
        """
        Vector similarity search.

        Returns source text, metadata/entities, and vector distance.
        """
        with self.conn.cursor() as cur:
            cur.execute("""
                SELECT
                    id,
                    source,
                    chunk_index,
                    text,
                    entities,
                    embedding <-> %s::vector AS distance
                FROM documents
                ORDER BY embedding <-> %s::vector
                LIMIT %s;
            """, (
                query_embedding,
                query_embedding,
                top_k
            ))

            return cur.fetchall()

    def close(self):
        if self.conn:
            self.conn.close()
