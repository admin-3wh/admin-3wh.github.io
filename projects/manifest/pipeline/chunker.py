# manifest/pipeline/chunker.py

from typing import List

class TextChunker:
    def __init__(self, chunk_size=500, overlap=100):
        self.chunk_size = chunk_size
        self.overlap = overlap

    def chunk_text(self, text: str) -> List[str]:
        """
        Splits text into overlapping chunks.
        """
        chunks = []
        start = 0
        text_len = len(text)

        while start < text_len:
            end = min(start + self.chunk_size, text_len)
            chunk = text[start:end].strip()
            chunks.append(chunk)
            start += self.chunk_size - self.overlap

        return chunks
