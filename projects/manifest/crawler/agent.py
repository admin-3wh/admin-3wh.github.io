# manifest/crawler/agent.py

import aiohttp
import asyncio
import async_timeout

HEADERS = {
    "User-Agent": "ManifestBot/1.0 (+https://3wh.dev/manifest)",
    "Accept-Language": "en-US,en;q=0.9",
}

class CrawlerAgent:
    def __init__(self, timeout=10):
        self.timeout = timeout
        self.session = None

    async def __aenter__(self):
        self.session = aiohttp.ClientSession(headers=HEADERS)
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        await self.session.close()

    async def fetch(self, url):
        if self.session is None:
            self.session = aiohttp.ClientSession(headers=HEADERS)

        try:
            async with async_timeout.timeout(self.timeout):
                async with self.session.get(url, allow_redirects=True) as resp:
                    if resp.status == 200 and "text" in resp.headers.get("Content-Type", ""):
                        return await resp.text()
                    else:
                        print(f"[!] Non-200 or non-text response: {url} ({resp.status})")
                        return None
        except asyncio.TimeoutError:
            print(f"[!] Timeout fetching: {url}")
            return None
        except aiohttp.ClientError as e:
            print(f"[!] Client error fetching {url}: {e}")
            return None
        except Exception as e:
            print(f"[!] Unknown error fetching {url}: {e}")
            return None
