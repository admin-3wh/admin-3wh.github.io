# Phase 5 Kickoff: main.py (FastAPI Entrypoint)

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from vectorstore.pgvector import PGVectorStore  # Assuming existing vector logic is here
from services.embedder import generate_embedding  # Will be created next
from routes import alerts
app.include_router(alerts.router, prefix="/alerts")


app = FastAPI()
store = PGVectorStore()

# ----------------------
# /search Endpoint
# ----------------------

class SearchQuery(BaseModel):
    query: str
    top_k: int = 5

@app.post("/search")
async def search_docs(search: SearchQuery):
    try:
        query_embedding = generate_embedding(search.query)
        results = store.search(query_embedding, top_k=search.top_k)
        return {"results": results}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ----------------------
# Placeholder routes
# ----------------------

@app.get("/alerts")
def get_alerts():
    return {"alerts": []}  # Will be replaced in /api/alerts.py

@app.get("/digest")
def digest():
    return {"message": "Digest placeholder"}
