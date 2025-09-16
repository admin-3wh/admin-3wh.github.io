# manifest/scripts/test_ingest_and_search.py

from pipeline.router import IngestionRouter
from vectorstore.pgvector import PGVectorStore
from sentence_transformers import SentenceTransformer

# ---------- 🔧 Setup ----------

# Simulated global term stats (you can replace with real corpus stats later)
mock_term_counts = {
    "apple": 10000,
    "quantum": 45,
    "california": 2000,
    "fusion": 112,
}
total_docs = 50000

# Initialize router and vectorstore
router = IngestionRouter(term_counts=mock_term_counts, total_docs=total_docs)
store = PGVectorStore()

# ---------- 📄 Sample Document ----------

html_doc = """
    Apple Inc. announced a major breakthrough in quantum computing today,
    revealing a prototype chip developed in California that uses fusion-inspired qubit isolation.
    This marks a significant milestone in the race toward practical quantum computers.
"""

print("\n[+] Processing document...")

docs = router.process_document(html_doc, source_url="https://example.com/article1")

print(f"[✓] Generated {len(docs)} embedded chunk(s). Inserting into Postgres...")

store.insert_documents(docs)

# ---------- 🔍 Perform a Test Search ----------

query_text = "new chip in quantum computing"
print(f"\n[→] Semantic search: {query_text}")

# Generate embedding for the query
model = SentenceTransformer("all-MiniLM-L6-v2")
query_vec = model.encode(query_text, normalize_embeddings=True).tolist()

# Perform search
results = store.search(query_embedding=query_vec, top_k=3)

print("\n[🔎] Top Results:")
for i, row in enumerate(results, 1):
    print(f"\n#{i}:")
    print(f"Source:     {row['source']}")
    print(f"Chunk ID:   {row['id']}")
    print(f"Distance:   {round(row['distance'], 4)}")
    print(f"Text:       {row['text'][:150]}...")
