# apps/biomed/semantic_topic_detector.py

import yaml
from pathlib import Path
from typing import Dict, List, Tuple

from sentence_transformers import SentenceTransformer, util


CONFIG_PATH = Path("apps/biomed/biomed_config.yaml")


class SemanticTopicDetector:
    def __init__(
        self,
        config_path: str = str(CONFIG_PATH),
        model_name: str = "all-MiniLM-L6-v2",
        threshold: float = 0.25,
    ):
        self.config_path = config_path
        self.threshold = threshold
        self.model = SentenceTransformer(model_name)

        self.config = self._load_config()
        self.topic_phrases = self._build_topic_phrases()
        self.topic_embeddings = self.model.encode(
            [phrase for _, phrase in self.topic_phrases],
            convert_to_tensor=True,
            normalize_embeddings=True,
        )

    def _load_config(self) -> Dict:
        with open(self.config_path, "r") as f:
            return yaml.safe_load(f)

    def _build_topic_phrases(self) -> List[Tuple[str, str]]:
        """
        Returns list of tuples:
        (canonical_topic, phrase_to_compare)
        """
        phrases = []

        for topic in self.config.get("topics", []):
            phrases.append((topic, topic))

        for canonical, synonym_list in self.config.get("synonyms", {}).items():
            phrases.append((canonical, canonical))
            for synonym in synonym_list:
                phrases.append((canonical, synonym))

        # Remove duplicates while preserving order
        seen = set()
        deduped = []

        for canonical, phrase in phrases:
            key = (canonical.lower(), phrase.lower())
            if key not in seen:
                seen.add(key)
                deduped.append((canonical, phrase))

        return deduped

    def detect(self, text: str, top_n: int = 8) -> List[Dict]:
        """
        Detect semantically related biomedical topics in text.

        Returns:
        [
          {
            "topic": "inflammation",
            "matched_phrase": "chronic inflammation",
            "score": 0.61
          }
        ]
        """
        if not text or not text.strip():
            return []

        text_embedding = self.model.encode(
            text[:8000],
            convert_to_tensor=True,
            normalize_embeddings=True,
        )

        scores = util.cos_sim(text_embedding, self.topic_embeddings)[0]

        matches = []

        for idx, score in enumerate(scores):
            score_float = float(score)
            canonical, phrase = self.topic_phrases[idx]

            if score_float >= self.threshold:
                matches.append({
                    "topic": canonical,
                    "matched_phrase": phrase,
                    "score": round(score_float, 4),
                })

        matches.sort(key=lambda x: x["score"], reverse=True)

        # Deduplicate by canonical topic, keeping strongest match
        seen_topics = set()
        final = []

        for match in matches:
            if match["topic"] not in seen_topics:
                seen_topics.add(match["topic"])
                final.append(match)

            if len(final) >= top_n:
                break

        return final


if __name__ == "__main__":
    detector = SemanticTopicDetector()

    sample = """
    Chronic inflammation, immune aging, cytokine signaling, and cellular senescence
    are associated with age-related decline and loss of homeostasis.
    """

    results = detector.detect(sample)

    print("Semantic Topic Matches:")
    for result in results:
        print(
            f"- {result['topic']} "
            f"(matched: {result['matched_phrase']}, score: {result['score']})"
        )
