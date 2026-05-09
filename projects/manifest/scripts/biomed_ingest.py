# scripts/biomed_ingest.py

import sys
import os
from uuid import uuid4
from datetime import datetime, UTC
import yaml

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from sentence_transformers import SentenceTransformer

from vectorstore.pgvector import PGVectorStore
from utils.text_utils import chunk_text

from apps.biomed.semantic_topic_detector import SemanticTopicDetector
from apps.biomed.biomed_extract import extract_biomed_url

# ----------------------------
# Load biomedical config
# ----------------------------

CONFIG_PATH = "apps/biomed/biomed_config.yaml"

with open(CONFIG_PATH, "r") as f:
    config = yaml.safe_load(f)

BLOCKED_DOMAINS = config.get("blocked_domains", [])
MIN_TEXT_LENGTH = config["ingestion"]["min_text_length"]
MAX_TOKENS = config["ingestion"]["max_tokens_per_chunk"]

# ----------------------------
# Models / Store
# ----------------------------

model = SentenceTransformer("all-MiniLM-L6-v2")
store = PGVectorStore()

topic_detector = SemanticTopicDetector(
    threshold=0.32
)

# ----------------------------
# Helpers
# ----------------------------

def domain_blocked(url):
    return any(domain in url for domain in BLOCKED_DOMAINS)


def embed_chunks(chunks):
    return [model.encode(chunk).tolist() for chunk in chunks]


def analyze_chunks_semantically(chunks):

    all_matches = []
    discovered_topics = set()

    for idx, chunk in enumerate(chunks):

        matches = topic_detector.detect(chunk)

        if matches:

            print(f"\nChunk {idx} semantic matches:")

            for match in matches:

                print(
                    f"  - {match['topic']} "
                    f"(matched: {match['matched_phrase']}, score: {match['score']})"
                )

                discovered_topics.add(match["topic"])
                all_matches.append(match)

    return list(discovered_topics), all_matches


# ----------------------------
# Main ingestion logic
# ----------------------------

def ingest_biomed_url(url):

    print(f"\nFetching: {url}")

    if domain_blocked(url):
        print("Blocked domain.")
        return

    extraction_result = extract_biomed_url(url)

    text = extraction_result.get("text", "")
    title = extraction_result.get("title", "")
    extraction_method = extraction_result.get("extraction_method", "unknown")

    print(f"Extraction method: {extraction_method}")
    print(f"Title: {title}")

    if len(text) < MIN_TEXT_LENGTH:
        print("Text too short.")
        return

    chunks = chunk_text(text, max_tokens=MAX_TOKENS)

    if not chunks:
        print("No chunks created.")
        return

    print(f"Created {len(chunks)} chunks.")

    topics_found, semantic_matches = analyze_chunks_semantically(chunks)

    if not topics_found:
        print("No biomedical topics detected.")
        return

    print(f"\nDetected topics: {topics_found}")

    embeddings = embed_chunks(chunks)

    documents = []

    for idx, (chunk, embedding) in enumerate(zip(chunks, embeddings)):

        documents.append({
            "id": str(uuid4()),
            "source": url,
            "chunk_index": idx,
            "text": chunk,
            "embedding": embedding,
            "timestamp": datetime.now(UTC),
            "entities": {
                "app": "biomed",
                "topics": topics_found,
                "semantic_matches": semantic_matches,
                "title": title,
                "extraction_method": extraction_method
            }
        })

    store.add_documents(documents)

    print(f"\nIngested {len(documents)} chunks.")


# ----------------------------
# CLI
# ----------------------------

if __name__ == "__main__":

    print("Manifest Biomedical Ingest")

    while True:

        url = input("\nEnter biomedical URL (or 'exit'): ").strip()

        if url.lower() == "exit":
            break

        try:
            ingest_biomed_url(url)

        except Exception as e:
            print(f"\nError: {e}")
