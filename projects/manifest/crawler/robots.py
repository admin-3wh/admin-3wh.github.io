# manifest/crawler/robots.py

import aiohttp
import urllib.parse
from urllib.robotparser import RobotFileParser

class RobotsHandler:
    def __init__(self, user_agent="ManifestBot"):
        self.parsers = {}
        self.user_agent = user_agent

    async def is_allowed(self, url):
        domain = self._get_domain(url)

        if domain not in self.parsers:
            robots_url = urllib.parse.urljoin(f"https://{domain}", "/robots.txt")
            parser = RobotFileParser()
            parser.set_url(robots_url)

            try:
                async with aiohttp.ClientSession() as session:
                    async with session.get(robots_url, timeout=5) as resp:
                        if resp.status == 200:
                            content = await resp.text()
                            parser.parse(content.splitlines())
                        else:
                            parser.allow_all = True  # assume allowed if no robots.txt
            except Exception as e:
                print(f"[!] Failed to fetch robots.txt for {domain}: {e}")
                parser.allow_all = True  # fallback

            self.parsers[domain] = parser

        return self.parsers[domain].can_fetch(self.user_agent, url)

    def _get_domain(self, url):
        return urllib.parse.urlparse(url).netloc.lower()
