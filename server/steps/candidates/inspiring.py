from __future__ import annotations

from pathlib import Path
from typing import List

from . import ClipCandidate, find_clip_timestamps, find_clip_timestamps_batched
from config import INSPIRING_MIN_RATING, INSPIRING_MIN_WORDS
from .prompts import INSPIRING_PROMPT_DESC


def find_inspiring_timestamps_batched(
    transcript_path: str | Path,
    *,
    min_rating: float = INSPIRING_MIN_RATING,
    min_words: int = INSPIRING_MIN_WORDS,
    return_all_stages: bool = False,
    **kwargs,
) -> List[ClipCandidate]:
    """Find inspiring clip candidates using batched processing."""
    return find_clip_timestamps_batched(
        transcript_path,
        prompt_desc=INSPIRING_PROMPT_DESC,
        min_rating=min_rating,
        min_words=min_words,
        return_all_stages=return_all_stages,
        **kwargs,
    )


def find_inspiring_timestamps(
    transcript_path: str | Path,
    *,
    min_rating: float = INSPIRING_MIN_RATING,
    min_words: int = INSPIRING_MIN_WORDS,
    return_all_stages: bool = False,
    **kwargs,
) -> List[ClipCandidate]:
    """Find inspiring clip candidates."""
    return find_clip_timestamps(
        transcript_path,
        prompt_desc=INSPIRING_PROMPT_DESC,
        min_rating=min_rating,
        min_words=min_words,
        return_all_stages=return_all_stages,
        **kwargs,
    )


__all__ = ["find_inspiring_timestamps_batched", "find_inspiring_timestamps"]
