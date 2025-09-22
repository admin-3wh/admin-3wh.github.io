# projects/manifest/main.py

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from vectorstore.pgvector import PGVectorStore
from services.embedder import generate_embedding

from routes import alerts, digest

app = FastAPI()

# Root health check
@app.get("/")
def health():
    return {"message": "Manifest API is alive."}

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Set your frontend origin in prod
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Use /api prefix for clarity
app.include_router(alerts.router, prefix="/api/alerts")
app.include_router(digest.router, prefix="/api/digest")

# Vector search endpoint
store = PGVectorStore()

class SearchQuery(BaseModel):
    query: str
    top_k: int = 5

@app.post("/api/search")
async def search_docs(search: SearchQuery):
    try:
        query_embedding = generate_embedding(search.query)
        results = store.search(query_embedding, top_k=search.top_k)
        return {"results": results}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
