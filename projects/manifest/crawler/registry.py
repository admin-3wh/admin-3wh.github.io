# manifest/crawler/registry.py

import time

class CrawlRegistry:
    def __init__(self):
        self.visited_urls = {}
        self.max_age_seconds = 60 * 60 * 24  # 24h default TTL

    def has_recently_seen(self, url):
        """Check if URL has been crawled recently."""
        now = time.time()
        last_seen = self.visited_urls.get(url)
        if last_seen is None:
            return False
        return now - last_seen < self.max_age_seconds

    def mark_seen(self, url):
        """Mark a URL as seen now."""
        self.visited_urls[url] = time.time()

    def purge_old(self):
        """Remove stale entries (run occasionally if needed)."""
        now = time.time()
        expired = [url for url, ts in self.visited_urls.items() if now - ts > self.max_age_seconds]
        for url in expired:
            del self.visited_urls[url]
