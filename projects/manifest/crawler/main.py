# manifest/crawler/main.py

import asyncio
from fastapi import FastAPI

from crawler.scheduler import Scheduler
from crawler.agent import CrawlerAgent
from crawler.robots import RobotsHandler
from crawler.hash_utils import ContentHasher
from crawler.registry import CrawlRegistry

app = FastAPI()

SEED_URLS = [
    "https://example.com",
    "https://arxiv.org",
    # Add more seed targets here
]

@app.get("/")
async def health_check():
    return {"status": "Manifest Crawler API is up!"}

@app.post("/crawl")
async def start_crawl():
    asyncio.create_task(run_crawler())  # runs in background
    return {"message": "Crawl started in background."}

async def run_crawler():
    print("[+] Starting Manifest Crawler Engine...")

    scheduler = Scheduler()
    agent = CrawlerAgent()
    robots = RobotsHandler()
    hasher = ContentHasher()
    registry = CrawlRegistry()

    for url in SEED_URLS:
        await scheduler.enqueue(url)

    while not scheduler.is_empty():
        url = await scheduler.dequeue()
        if url is None:
            break

        if registry.has_recently_seen(url):
            print(f"[•] Skipped (already crawled recently): {url}")
            continue

        print(f"[*] Checking robots.txt: {url}")
        if not await robots.is_allowed(url):
            print(f"[x] Skipped (robots.txt disallow): {url}")
            continue

        print(f"[*] Crawling: {url}")
        content = await agent.fetch(url)

        if content:
            registry.mark_seen(url)

            if hasher.is_duplicate(content):
                print(f"[•] Duplicate content skipped: {url}")
            else:
                print(f"[✓] Unique content: {url} ({len(content)} bytes)")
                # ➜ Future: Send to parser/ → embed/ → vectorstore/
        else:
            print(f"[x] Failed to fetch: {url}")

    print("[✓] Crawling complete.")
