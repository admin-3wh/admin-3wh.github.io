# projects/manifest/main.py

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from vectorstore.pgvector import PGVectorStore
from services.embedder import generate_embedding

from routes import alerts, digest  # Make sure these are correctly structured with routers

# Initialize FastAPI app
app = FastAPI()

# Add CORS (important for React)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Replace * with your frontend origin in prod
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(alerts.router, prefix="/alerts")
app.include_router(digest.router, prefix="/digest")

# Vector store
store = PGVectorStore()

# Search schema
class SearchQuery(BaseModel):
    query: str
    top_k: int = 5

# Main /search route
@app.post("/search")
async def search_docs(search: SearchQuery):
    try:
        query_embedding = generate_embedding(search.query)
        results = store.search(query_embedding, top_k=search.top_k)
        return {"results": results}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
