# projects/manifest/main.py

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from vectorstore.pgvector import PGVectorStore
from services.embedder import generate_embedding

from routes import alerts, digest  # Ensure these are properly importing 'router'

app = FastAPI()

# CORS for frontend integration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Replace with your frontend domain in prod
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Route registration under /api
app.include_router(alerts.router, prefix="/api/alerts")
app.include_router(digest.router, prefix="/api/digest")

# Optional root route for testing
@app.get("/")
def root():
    return {"message": "Manifest API is alive"}

# Vector store search schema
class SearchQuery(BaseModel):
    query: str
    top_k: int = 5

# /api/search endpoint
@app.post("/api/search")
async def search_docs(search: SearchQuery):
    try:
        query_embedding = generate_embedding(search.query)
        results = store.search(query_embedding, top_k=search.top_k)
        return {"results": results}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
