# scripts/biomed_discover.py

import sys
import os
import time
from collections import defaultdict

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import yaml

from apps.biomed.pubmed_search import PubMedSearch
from apps.biomed.biomed_extract import extract_biomed_url
from apps.biomed.semantic_topic_detector import SemanticTopicDetector
from scripts.biomed_ingest import ingest_biomed_url
from utils.text_utils import chunk_text


CONFIG_PATH = "apps/biomed/biomed_config.yaml"

with open(CONFIG_PATH, "r") as f:
    config = yaml.safe_load(f)

MAX_TOKENS = config["ingestion"]["max_tokens_per_chunk"]
MIN_TEXT_LENGTH = config["ingestion"]["min_text_length"]

topic_detector = SemanticTopicDetector(threshold=0.32)


def score_article_url(url: str):
    extraction = extract_biomed_url(url)

    title = extraction.get("title", "")
    text = extraction.get("text", "")
    extraction_method = extraction.get("extraction_method", "unknown")

    if len(text) < MIN_TEXT_LENGTH:
        return {
            "accepted": False,
            "reason": "text_too_short",
            "title": title,
            "url": url,
            "extraction_method": extraction_method,
            "topics": [],
            "score_summary": [],
            "chunk_count": 0,
            "text_length": len(text),
        }

    chunks = chunk_text(text, max_tokens=MAX_TOKENS)

    topic_scores = defaultdict(list)

    for chunk in chunks:
        matches = topic_detector.detect(chunk)

        for match in matches:
            topic_scores[match["topic"]].append(match["score"])

    ranked_topics = []

    for topic, scores in topic_scores.items():
        ranked_topics.append({
            "topic": topic,
            "hits": len(scores),
            "max_score": max(scores),
            "avg_score": sum(scores) / len(scores),
        })

    ranked_topics.sort(
        key=lambda item: (item["hits"], item["max_score"], item["avg_score"]),
        reverse=True,
    )

    strong_hits = [
        item for item in ranked_topics
        if item["max_score"] >= 0.42 or item["hits"] >= 3
    ]

    accepted = bool(strong_hits)

    return {
        "accepted": accepted,
        "reason": "accepted" if accepted else "weak_semantic_relevance",
        "title": title,
        "url": url,
        "extraction_method": extraction_method,
        "topics": [item["topic"] for item in ranked_topics[:12]],
        "score_summary": ranked_topics[:12],
        "chunk_count": len(chunks),
        "text_length": len(text),
    }


def print_article_result(index: int, article: dict, scored: dict):
    print("\n" + "=" * 90)
    print(f"[{index}] {article.get('title')}")
    print("=" * 90)

    print(f"Year: {article.get('year') or 'N/A'}")
    print(f"Journal: {article.get('journal') or 'N/A'}")
    print(f"PMID: {article.get('pmid') or 'N/A'}")
    print(f"PMCID: {article.get('pmcid') or 'N/A'}")
    print(f"PMC URL: {article.get('pmc_url') or 'N/A'}")
    print(f"Decision: {'ACCEPT' if scored['accepted'] else 'REJECT'}")
    print(f"Reason: {scored['reason']}")
    print(f"Extraction: {scored.get('extraction_method', 'unknown')}")
    print(f"Text length: {scored.get('text_length', 0)}")
    print(f"Chunks: {scored.get('chunk_count', 0)}")

    print("\nTop topics:")

    if scored["score_summary"]:
        for item in scored["score_summary"][:10]:
            print(
                f"- {item['topic']}: "
                f"hits={item['hits']}, "
                f"max={item['max_score']:.4f}, "
                f"avg={item['avg_score']:.4f}"
            )
    else:
        print("- None detected")

    abstract = article.get("abstract", "")

    if abstract:
        print("\nAbstract preview:")
        print(abstract[:700] + ("..." if len(abstract) > 700 else ""))


def discover(query: str, max_results: int = 5, auto_ingest: bool = False):
    searcher = PubMedSearch()

    print(f"\nSearching PubMed for: {query}")
    articles = searcher.search_and_fetch(query=query, max_results=max_results)

    print(f"\nFound {len(articles)} PubMed articles.")

    accepted_articles = []

    for idx, article in enumerate(articles, 1):
        time.sleep(3)

        pmc_url = article.get("pmc_url")

        if not pmc_url:
            print("\n" + "=" * 90)
            print(f"[{idx}] {article.get('title')}")
            print("=" * 90)
            print("Skipping: no open PMC full-text URL.")
            continue

        try:
            scored = score_article_url(pmc_url)
            print_article_result(idx, article, scored)

            if scored["accepted"]:
                accepted_articles.append({
                    "article": article,
                    "score": scored,
                })

                if auto_ingest:
                    print("\nAuto-ingesting accepted article...")
                    ingest_biomed_url(pmc_url)

        except Exception as e:
            print("\n" + "=" * 90)
            print(f"[{idx}] {article.get('title')}")
            print("=" * 90)
            print(f"Error while scoring article: {e}")

    print("\n" + "=" * 90)
    print("DISCOVERY SUMMARY")
    print("=" * 90)
    print(f"Accepted articles: {len(accepted_articles)} / {len(articles)}")

    for item in accepted_articles:
        article = item["article"]
        score = item["score"]

        print(f"\n- {article.get('title')}")
        print(f"  PMC: {article.get('pmc_url')}")
        print(f"  Topics: {', '.join(score.get('topics', [])[:8])}")

    return accepted_articles


if __name__ == "__main__":
    print("Manifest Biomedical Discovery")

    query = input("\nEnter PubMed discovery query: ").strip()
    max_results_raw = input("Max results [5]: ").strip()
    auto_ingest_raw = input("Auto-ingest accepted articles? [y/N]: ").strip().lower()

    max_results = int(max_results_raw) if max_results_raw else 5
    auto_ingest = auto_ingest_raw == "y"

    discover(
        query=query,
        max_results=max_results,
        auto_ingest=auto_ingest,
    )
