# projects/manifest/models.py

import os

# Switch between "openai" and "local"
EMBEDDING_MODE = os.getenv("EMBEDDING_MODE", "openai")

if EMBEDDING_MODE == "openai":
    from langchain.embeddings import OpenAIEmbeddings

    def get_embedder():
        return OpenAIEmbeddings(model="text-embedding-3-small")  # or "text-embedding-3-large"

else:
    from langchain.embeddings import HuggingFaceEmbeddings
    # e.g., instructor-xl, all-MiniLM-L6-v2, etc.
    def get_embedder():
        return HuggingFaceEmbeddings(model_name="sentence-transformers/all-MiniLM-L6-v2")
