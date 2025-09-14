# manifest/crawler/main.py

import asyncio
from crawler.scheduler import Scheduler
from crawler.agent import CrawlerAgent

SEED_URLS = [
    "https://example.com",
    "https://arxiv.org",
    # Add more seed targets here
]

async def run_crawler():
    print("[+] Starting Manifest Crawler Engine...")

    scheduler = Scheduler()
    agent = CrawlerAgent()

    # Queue initial seed URLs
    for url in SEED_URLS:
        await scheduler.enqueue(url)

    # Main crawl loop
    while not scheduler.is_empty():
        url = await scheduler.dequeue()
        if url is None:
            break

        print(f"[*] Crawling: {url}")
        content = await agent.fetch(url)

        if content:
            # Placeholder: future step to process & route content to ETL
            print(f"[✓] {url} fetched, {len(content)} bytes")
        else:
            print(f"[x] Failed to fetch: {url}")

    print("[✓] Crawling complete.")

if __name__ == "__main__":
    asyncio.run(run_crawler())
