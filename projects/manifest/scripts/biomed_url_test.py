# scripts/biomed_url_test.py

import sys
import os
from collections import defaultdict

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import yaml

from utils.text_utils import chunk_text
from apps.biomed.biomed_extract import extract_biomed_url
from apps.biomed.semantic_topic_detector import SemanticTopicDetector


CONFIG_PATH = "apps/biomed/biomed_config.yaml"

with open(CONFIG_PATH, "r") as f:
    config = yaml.safe_load(f)

MAX_TOKENS = config["ingestion"]["max_tokens_per_chunk"]
MIN_TEXT_LENGTH = config["ingestion"]["min_text_length"]

topic_detector = SemanticTopicDetector(threshold=0.32)


def score_url(url: str):
    print(f"\nTesting URL: {url}")

    extraction = extract_biomed_url(url)

    title = extraction.get("title", "")
    text = extraction.get("text", "")
    extraction_method = extraction.get("extraction_method", "unknown")

    print("\nMetadata")
    print("-" * 60)
    print(f"Title: {title}")
    print(f"Extraction method: {extraction_method}")
    print(f"Text length: {len(text)}")

    if len(text) < MIN_TEXT_LENGTH:
        print("\nDecision: REJECT")
        print("Reason: extracted text is too short.")
        return

    chunks = chunk_text(text, max_tokens=MAX_TOKENS)

    print(f"Chunks: {len(chunks)}")

    topic_scores = defaultdict(list)
    chunk_hits = []

    for idx, chunk in enumerate(chunks):
        matches = topic_detector.detect(chunk)

        if not matches:
            continue

        for match in matches:
            topic_scores[match["topic"]].append(match["score"])

        chunk_hits.append({
            "chunk_index": idx,
            "matches": matches,
            "preview": chunk[:350]
        })

    ranked_topics = []

    for topic, scores in topic_scores.items():
        ranked_topics.append({
            "topic": topic,
            "max_score": max(scores),
            "avg_score": sum(scores) / len(scores),
            "hits": len(scores)
        })

    ranked_topics.sort(
        key=lambda x: (x["hits"], x["max_score"], x["avg_score"]),
        reverse=True
    )

    print("\nTop Semantic Topics")
    print("-" * 60)

    if not ranked_topics:
        print("No semantic topics detected.")
        print("\nDecision: REJECT")
        return

    for item in ranked_topics[:15]:
        print(
            f"- {item['topic']}: "
            f"hits={item['hits']}, "
            f"max={item['max_score']:.4f}, "
            f"avg={item['avg_score']:.4f}"
        )

    print("\nBest Matching Chunks")
    print("-" * 60)

    for hit in chunk_hits[:5]:
        print(f"\nChunk {hit['chunk_index']}:")
        for match in hit["matches"][:5]:
            print(
                f"  - {match['topic']} "
                f"(matched: {match['matched_phrase']}, score: {match['score']})"
            )
        print(f"  Preview: {hit['preview']}...")

    print("\nDecision")
    print("-" * 60)

    strong_hits = [
        item for item in ranked_topics
        if item["max_score"] >= 0.42 or item["hits"] >= 3
    ]

    if strong_hits:
        print("ACCEPT: URL appears relevant to the biomedical scope.")
    else:
        print("MAYBE: URL has weak semantic relevance. Review manually before ingesting.")

    print("\nExtracted Text Preview")
    print("-" * 60)
    print(text[:1500])


if __name__ == "__main__":
    print("Manifest Biomedical URL Test")

    while True:
        url = input("\nEnter biomedical URL to test (or 'exit'): ").strip()

        if url.lower() == "exit":
            break

        try:
            score_url(url)
        except Exception as e:
            print(f"\nError: {e}")
