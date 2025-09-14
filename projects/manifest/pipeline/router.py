# manifest/pipeline/router.py

from parser.ner import EntityExtractor
from parser.idq import IDQScorer
from pipeline.chunker import TextChunker
from pipeline.embed import Embedder

from typing import Dict, List
import re

class IngestionRouter:
    def __init__(self, term_counts: Dict[str, int], total_docs: int):
        self.ner = EntityExtractor()
        self.idq = IDQScorer(term_counts, total_docs)
        self.chunker = TextChunker()
        self.embedder = Embedder()

    def clean_text(self, html: str) -> str:
        """Basic HTML tag stripping (can be replaced by BeautifulSoup later)."""
        return re.sub(r'<[^>]+>', '', html)

    def process_document(self, html: str, source_url: str) -> List[Dict]:
        """
        Full ETL: HTML → clean → NER → IDQ → chunk → embed
        Returns embedded docs ready for vectorstore insertion.
        """
        text = self.clean_text(html)
        entities = self.ner.extract_entities(text)

        # Apply IDQ scoring to each entity
        for ent in entities:
            ent["idq"] = self.idq.compute_idq(ent, context_len=len(text))

        # Add more logic later: summarization, relation linking, alert flagging

        chunks = self.chunker.chunk_text(text)
        embedded_docs = self.embedder.embed_chunks(chunks, source_url=source_url)

        # For now, attach IDQ-rich entities to each chunk as metadata
        for doc in embedded_docs:
            doc["entities"] = entities  # optional: filter by IDQ > X

        return embedded_docs
