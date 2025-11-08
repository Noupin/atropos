"""Utilities for persisting subscriber and unsubscribe token data."""

from __future__ import annotations

import json
from typing import Dict, List

from .config import SUBSCRIBERS, UNSUB_TOKENS


def load_subscribers() -> list[str]:
    try:
        return json.loads(SUBSCRIBERS.read_text(encoding="utf-8"))
    except Exception:
        return []


def save_subscribers(subscribers: List[str]) -> None:
    SUBSCRIBERS.write_text(
        json.dumps(sorted(set(subscribers)), ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def load_tokens() -> dict[str, str]:
    try:
        return json.loads(UNSUB_TOKENS.read_text(encoding="utf-8"))
    except Exception:
        return {}


def save_tokens(tokens: Dict[str, str]) -> None:
    UNSUB_TOKENS.write_text(
        json.dumps(tokens, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


__all__ = [
    "load_subscribers",
    "load_tokens",
    "save_subscribers",
    "save_tokens",
]
