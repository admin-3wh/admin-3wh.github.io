# apps/aletheia/document_registry.py

import hashlib
from pathlib import Path
from datetime import datetime, UTC

import psycopg
from psycopg.rows import dict_row


DSN = "postgresql://user2:newpassword123@localhost:5432/manifest_db"


class DocumentRegistry:
    def __init__(self, dsn: str = DSN):
        self.dsn = dsn
        self.conn = psycopg.connect(self.dsn, row_factory=dict_row)
        self._create_table()

    def _create_table(self):
        with self.conn.cursor() as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS private_documents (
                    id SERIAL PRIMARY KEY,
                    app TEXT NOT NULL,
                    filename TEXT NOT NULL,
                    file_path TEXT NOT NULL,
                    extension TEXT,
                    file_hash TEXT UNIQUE,
                    document_type TEXT,
                    source TEXT,
                    author TEXT,
                    language TEXT DEFAULT 'unknown',
                    tags JSONB DEFAULT '[]'::jsonb,
                    summary TEXT,
                    text_length INT DEFAULT 0,
                    chunks_created INT DEFAULT 0,
                    uploaded_at TIMESTAMPTZ DEFAULT NOW(),
                    updated_at TIMESTAMPTZ DEFAULT NOW()
                );
            """)

            cur.execute("""
                CREATE INDEX IF NOT EXISTS idx_private_documents_app
                ON private_documents (app);
            """)

            cur.execute("""
                CREATE INDEX IF NOT EXISTS idx_private_documents_filename
                ON private_documents (filename);
            """)

            self.conn.commit()

    def compute_hash(self, file_path: str) -> str:
        path = Path(file_path)

        sha = hashlib.sha256()

        with open(path, "rb") as f:
            for block in iter(lambda: f.read(8192), b""):
                sha.update(block)

        return sha.hexdigest()

    def upsert_document(
        self,
        app: str,
        filename: str,
        file_path: str,
        extension: str,
        text_length: int = 0,
        chunks_created: int = 0,
        document_type: str | None = None,
        source: str | None = None,
        author: str | None = None,
        language: str = "unknown",
        tags: list | None = None,
        summary: str | None = None,
    ):
        file_hash = self.compute_hash(file_path)
        tags = tags or []

        with self.conn.cursor() as cur:
            cur.execute("""
                INSERT INTO private_documents (
                    app,
                    filename,
                    file_path,
                    extension,
                    file_hash,
                    document_type,
                    source,
                    author,
                    language,
                    tags,
                    summary,
                    text_length,
                    chunks_created,
                    uploaded_at,
                    updated_at
                )
                VALUES (
                    %s, %s, %s, %s, %s, %s, %s, %s, %s,
                    %s::jsonb, %s, %s, %s, %s, %s
                )
                ON CONFLICT (file_hash)
                DO UPDATE SET
                    filename = EXCLUDED.filename,
                    file_path = EXCLUDED.file_path,
                    extension = EXCLUDED.extension,
                    text_length = EXCLUDED.text_length,
                    chunks_created = EXCLUDED.chunks_created,
                    updated_at = EXCLUDED.updated_at
                RETURNING *;
            """, (
                app,
                filename,
                file_path,
                extension,
                file_hash,
                document_type,
                source,
                author,
                language,
                psycopg.types.json.Jsonb(tags),
                summary,
                text_length,
                chunks_created,
                datetime.now(UTC),
                datetime.now(UTC),
            ))

            row = cur.fetchone()
            self.conn.commit()
            return row

    def list_documents(self, app: str = "aletheia"):
        with self.conn.cursor() as cur:
            cur.execute("""
                SELECT *
                FROM private_documents
                WHERE app = %s
                ORDER BY uploaded_at DESC;
            """, (app,))

            return cur.fetchall()

    def close(self):
        if self.conn:
            self.conn.close()
