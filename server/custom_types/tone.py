from __future__ import annotations

from dataclasses import dataclass
from enum import Enum

from config import DEFAULT_MIN_RATING, DEFAULT_MIN_WORDS, SNAP_TO_DIALOG, SNAP_TO_SENTENCE, SNAP_TO_SILENCE



@dataclass
class ToneStrategy:
    prompt_desc: str
    rating_descriptions: dict[str, str] | None = None
    min_rating: float = DEFAULT_MIN_RATING
    min_words: int = DEFAULT_MIN_WORDS
    snap_to_sentence: bool = SNAP_TO_SENTENCE
    snap_to_dialog: bool = SNAP_TO_DIALOG
    snap_to_silence: bool = SNAP_TO_SILENCE


__all__ = ["ToneStrategy"]
