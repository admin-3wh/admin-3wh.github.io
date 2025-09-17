# services/embedder.py

import openai

def generate_embedding(text: str) -> list[float]:
    response = openai.Embedding.create(
        model="text-embedding-ada-002",
        input=[text]
    )
    return response['data'][0]['embedding']
