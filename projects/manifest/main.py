# projects/manifest/main.py

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from routes.biomed import router as biomed_router


app = FastAPI(
    title="Manifest API",
    description="Manifest Biomedical Intelligence Platform",
    version="0.1.0",
)


@app.get("/")
def health():
    return {
        "message": "Manifest API is alive."
    }


app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # tighten in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


app.include_router(biomed_router)
