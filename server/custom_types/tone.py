from __future__ import annotations

from dataclasses import dataclass
from enum import Enum

from config import DEFAULT_MIN_RATING, DEFAULT_MIN_WORDS


class Tone(Enum):
    FUNNY = "funny"
    SPACE = "space"
    HISTORY = "history"
    TECH = "tech"
    HEALTH = "health"


@dataclass
class ToneStrategy:
    prompt_desc: str
    rating_descriptions: dict[str, str] | None = None
    min_rating: float = DEFAULT_MIN_RATING
    min_words: int = DEFAULT_MIN_WORDS
    snap_to_sentence: bool = True
    snap_to_dialog: bool = True
    snap_to_silence: bool = True


__all__ = ["Tone", "ToneStrategy"]
