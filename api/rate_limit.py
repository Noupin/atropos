from __future__ import annotations

import threading
import time
from collections import defaultdict
from typing import Dict, List


class RateLimiter:
    """Simple in-memory rate limiter keyed by client identifier."""

    def __init__(self, window_seconds: int, max_requests: int):
        self.window_seconds = max(0, window_seconds)
        self.max_requests = max(1, max_requests)
        self._bucket: Dict[str, List[float]] = defaultdict(list)
        self._lock = threading.Lock()

    def allow(self, key: str) -> bool:
        now = time.time()
        with self._lock:
            events = [
                timestamp
                for timestamp in self._bucket.get(key, [])
                if now - timestamp < self.window_seconds
            ]
            events.append(now)
            self._bucket[key] = events
            return len(events) <= self.max_requests
