"""Exponential backoff helper."""

from __future__ import annotations

import time
from typing import Callable, TypeVar


T = TypeVar("T")


def retry(fn: Callable[[], T], attempts: int, base_delay: float) -> T:
    """Execute ``fn`` with exponential backoff."""

    for attempt in range(1, attempts + 1):
        try:
            return fn()
        except Exception:  # pragma: no cover - simple utility
            if attempt == attempts:
                raise
            time.sleep(base_delay * (2 ** (attempt - 1)))


__all__ = ["retry"]

