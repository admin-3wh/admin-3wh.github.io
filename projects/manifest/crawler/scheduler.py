# manifest/crawler/scheduler.py

import asyncio
import time
import urllib.parse
from collections import deque, defaultdict

CRAWL_DELAY = 5  # seconds between hits to the same domain

class Scheduler:
    def __init__(self):
        self.queue = deque()
        self.last_access = defaultdict(lambda: 0)
        self.lock = asyncio.Lock()

    async def enqueue(self, url):
        """Add a new URL to the queue if not already present."""
        async with self.lock:
            if url not in self.queue:
                self.queue.append(url)

    async def dequeue(self):
        """Pop a URL from the queue, respecting domain-based delay."""
        while self.queue:
            async with self.lock:
                url = self.queue.popleft()

            domain = self.get_domain(url)
            elapsed = time.time() - self.last_access[domain]

            if elapsed < CRAWL_DELAY:
                # Not enough time has passed; wait and requeue
                await asyncio.sleep(CRAWL_DELAY - elapsed)
                await self.enqueue(url)
                await asyncio.sleep(0.1)
                continue

            self.last_access[domain] = time.time()
            return url

        return None  # Queue is empty

    def is_empty(self):
        return len(self.queue) == 0

    @staticmethod
    def get_domain(url):
        parsed = urllib.parse.urlparse(url)
        return parsed.netloc.lower()
