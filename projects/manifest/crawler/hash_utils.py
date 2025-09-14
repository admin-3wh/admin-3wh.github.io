# manifest/crawler/hash_utils.py

import hashlib

class ContentHasher:
    def __init__(self):
        self.seen_hashes = set()  # Optional: can later move to DB or Redis

    def hash_text(self, text):
        """Returns a SHA256 hash of the given string."""
        return hashlib.sha256(text.encode("utf-8")).hexdigest()

    def is_duplicate(self, text):
        """Checks if text has been seen before using hash."""
        content_hash = self.hash_text(text)
        if content_hash in self.seen_hashes:
            return True

        self.seen_hashes.add(content_hash)
        return False
