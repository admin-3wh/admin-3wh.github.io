# manifest/crawler/main.py

import asyncio
from crawler.scheduler import Scheduler
from crawler.agent import CrawlerAgent
from crawler.robots import RobotsHandler
from crawler.hash_utils import ContentHasher

SEED_URLS = [
    "https://example.com",
    "https://arxiv.org",
    # Add more seed targets here
]

async def run_crawler():
    print("[+] Starting Manifest Crawler Engine...")

    scheduler = Scheduler()
    agent = CrawlerAgent()
    robots = RobotsHandler()
    hasher = ContentHasher()

    for url in SEED_URLS:
        await scheduler.enqueue(url)

    while not scheduler.is_empty():
        url = await scheduler.dequeue()
        if url is None:
            break

        print(f"[*] Checking robots.txt: {url}")
        if not await robots.is_allowed(url):
            print(f"[x] Skipped (robots.txt disallow): {url}")
            continue

        print(f"[*] Crawling: {url}")
        content = await agent.fetch(url)

        if content:
            if hasher.is_duplicate(content):
                print(f"[•] Duplicate content skipped: {url}")
            else:
                print(f"[✓] Unique content: {url} ({len(content)} bytes)")
                # ➜ Next: route to parser/ → embed/ → vectorstore/
        else:
            print(f"[x] Failed to fetch: {url}")

    print("[✓] Crawling complete.")

if __name__ == "__main__":
    asyncio.run(run_crawler())
