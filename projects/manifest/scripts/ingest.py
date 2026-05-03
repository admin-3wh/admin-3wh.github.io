import uuid
from datetime import datetime
from sentence_transformers import SentenceTransformer
from vectorstore.pgvector import PGVectorStore

# initialize the store
store = PGVectorStore()

# load the embedding model
model = SentenceTransformer("all-MiniLM-L6-v2")

def ingest_text(source: str, text: str):
    """
    Take a text string, split into chunks (right now just one chunk),
    embed it, and insert into PGVector.
    """
    chunks = [text]  # later you can add real chunking here
    documents = []

    for idx, chunk in enumerate(chunks):
        #  define embedding inside the loop
        embedding = model.encode(chunk).tolist()

        documents.append({
            "id": str(uuid.uuid4()),
            "source": source,
            "chunk_index": idx,
            "text": chunk,
            "embedding": embedding,
            "timestamp": datetime.now(),
            "entities": []
        })

    # use add_documents function
    store.add_documents(documents)

# --- test ingestion ---
sample_text = "This is a test document for Manifest ingestion."
ingest_text("Sample Source", sample_text)
print("Ingestion complete.")
