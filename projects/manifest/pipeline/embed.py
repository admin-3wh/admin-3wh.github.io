# manifest/pipeline/embed.py

from sentence_transformers import SentenceTransformer
from typing import List, Dict
import uuid
import datetime

class Embedder:
    def __init__(self, model_name="all-MiniLM-L6-v2"):
        self.model = SentenceTransformer(model_name)

    def embed_chunks(self, chunks: List[str], source_url: str = "") -> List[Dict]:
        """
        Embeds each text chunk and returns list of dicts with vector and metadata.
        """
        vectors = self.model.encode(chunks, convert_to_numpy=True, normalize_embeddings=True)
        now = datetime.datetime.utcnow().isoformat()

        results = []
        for i, (chunk, vec) in enumerate(zip(chunks, vectors)):
            results.append({
                "id": str(uuid.uuid4()),
                "source": source_url,
                "chunk_index": i,
                "text": chunk,
                "embedding": vec.tolist(),  # convert NumPy array to JSON-serializable
                "timestamp": now,
            })

        return results
