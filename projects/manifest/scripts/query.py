import os
import torch
import psycopg2
import numpy as np
from sentence_transformers import SentenceTransformer, util
from dotenv import load_dotenv

load_dotenv()

DB_CONFIG = {
    "host": os.getenv("POSTGRES_HOST", "localhost"),
    "port": os.getenv("POSTGRES_PORT", "5432"),
    "user": os.getenv("POSTGRES_USER", "manifest_user"),
    "password": os.getenv("POSTGRES_PASSWORD", ""),
    "dbname": os.getenv("POSTGRES_DB", "manifest"),
}

model = SentenceTransformer("sentence-transformers/all-MiniLM-L6-v2")

def get_connection():
    return psycopg2.connect(**DB_CONFIG)

def query_db(embedding, top_k=5):
    conn = get_connection()
    cur = conn.cursor()

    sql = """
    SELECT id, source, chunk_index, text,
           1 - (embedding <#> %s::vector) AS similarity
    FROM documents
    ORDER BY embedding <#> %s::vector
    LIMIT %s;
    """
    cur.execute(sql, (embedding.tolist(), embedding.tolist(), top_k))
    results = cur.fetchall()
    cur.close()
    conn.close()

    return results

def search(query, top_k=5):
    embedding = model.encode(query, convert_to_tensor=True, normalize_embeddings=True)
    return query_db(embedding, top_k)

if __name__ == "__main__":
    print("Manifest Query Interface")
    while True:
        user_input = input("\n🔍 Enter query (or 'exit'): ")
        if user_input.strip().lower() == "exit":
            break
        results = search(user_input, top_k=7)
        print("\nTop Results:")
        for i, (id, source, chunk_idx, text, sim) in enumerate(results, 1):
            print(f"\n[{i}] Source: {source} (chunk {chunk_idx})")
            print(f"    Similarity: {sim:.4f}")
            print(f"    Text: {text[:300]}...")
