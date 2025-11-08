"""Simple in-memory rate limiting utilities."""

from __future__ import annotations

import threading
import time
from collections import defaultdict
from typing import Dict, List


class RateLimiter:
    """Simple IP-based rate limiter using a sliding window."""

    def __init__(self, max_requests: int, window_seconds: int) -> None:
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        self._bucket: Dict[str, List[float]] = defaultdict(list)
        self._lock = threading.Lock()

    def allow(self, key: str) -> bool:
        """Return True when the request for *key* is within the limit."""

        now = time.time()
        with self._lock:
            timestamps = [stamp for stamp in self._bucket[key] if now - stamp < self.window_seconds]
            timestamps.append(now)
            self._bucket[key] = timestamps
            return len(timestamps) <= self.max_requests


__all__ = ["RateLimiter"]
