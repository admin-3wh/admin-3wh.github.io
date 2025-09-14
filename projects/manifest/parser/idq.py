# manifest/parser/idq.py

import math
from typing import List, Dict

class IDQScorer:
    def __init__(self, global_term_counts: Dict[str, int], total_docs: int):
        """
        :param global_term_counts: A dictionary of term → document frequency
        :param total_docs: Total number of documents seen in corpus
        """
        self.term_counts = global_term_counts
        self.total_docs = total_docs

    def compute_rarity(self, term: str) -> float:
        """Compute inverse frequency for a given term."""
        df = self.term_counts.get(term.lower(), 1)
        return math.log((self.total_docs + 1) / (df + 1)) + 1  # smoothed IDF

    def compute_idq(self, entity: Dict, context_len: int) -> float:
        """
        Compute Information Density Quotient for a single entity.
        :param entity: Dict with keys ['text', 'label', 'confidence', 'start_char', 'end_char']
        :param context_len: Total length of the surrounding text chunk
        """
        term = entity['text']
        rarity = self.compute_rarity(term)
        confidence = entity.get('confidence') or 1.0
        span = entity['end_char'] - entity['start_char']
        span_factor = 1.0 - min(span / context_len, 0.9)  # penalize long spans

        idq = rarity * confidence * span_factor
        return round(idq, 4)
