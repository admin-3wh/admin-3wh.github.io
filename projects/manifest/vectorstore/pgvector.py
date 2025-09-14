# manifest/vectorstore/pgvector.py

import psycopg
from psycopg.rows import dict_row
from typing import List, Dict
import numpy as np

class PGVectorStore:
    def __init__(self, dsn: str = "postgresql://user:pass@localhost:5432/manifest"):
        self.dsn = dsn
        self.conn = psycopg.connect(self.dsn, row_factory=dict_row)
        self._create_table()

    def _create_table(self):
        with self.conn.cursor() as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS documents (
                    id UUID PRIMARY KEY,
                    source TEXT,
                    chunk_index INT,
                    text TEXT,
                    embedding vector(384),  -- depends on model used
                    timestamp TIMESTAMPTZ,
                    entities JSONB
                );
            """)
            self.conn.commit()

    def insert_documents(self, docs: List[Dict]):
        with self.conn.cursor() as cur:
            for doc in docs:
                cur.execute("""
                    INSERT INTO documents (id, source, chunk_index, text, embedding, timestamp, entities)
                    VALUES (%s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (id) DO NOTHING;
                """, (
                    doc["id"],
                    doc["source"],
                    doc["chunk_index"],
                    doc["text"],
                    doc["embedding"],
                    doc["timestamp"],
                    doc.get("entities", [])
                ))
            self.conn.commit()

    def search(self, query_embedding: List[float], top_k: int = 5) -> List[Dict]:
        query_vec = np.array(query_embedding)
        with self.conn.cursor() as cur:
            cur.execute("""
                SELECT id, source, chunk_index, text, embedding <-> %s AS distance
                FROM documents
                ORDER BY embedding <-> %s
                LIMIT %s;
            """, (query_vec.tolist(), query_vec.tolist(), top_k))
            return cur.fetchall()
