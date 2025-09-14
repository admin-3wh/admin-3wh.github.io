# manifest/parser/ner.py

import spacy
from typing import List, Dict

class EntityExtractor:
    def __init__(self, model: str = "en_core_web_trf"):
        """
        :param model: SpaCy model to use (default: transformer-based NER)
        """
        try:
            self.nlp = spacy.load(model)
        except OSError:
            raise RuntimeError(f"Model '{model}' not found. Run: python -m spacy download {model}")

    def extract_entities(self, text: str) -> List[Dict]:
        """
        Runs NER on input text and returns structured entities.
        """
        doc = self.nlp(text)

        entities = []
        for ent in doc.ents:
            entities.append({
                "text": ent.text,
                "label": ent.label_,
                "start_char": ent.start_char,
                "end_char": ent.end_char,
                "confidence": getattr(ent, "_.confidence", None),  # transformer models can expose this
            })

        return entities
