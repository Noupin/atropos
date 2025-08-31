from __future__ import annotations

from pathlib import Path
from typing import List

from . import ClipCandidate, find_clip_timestamps, find_clip_timestamps_batched
from ...config import FUNNY_MIN_RATING, FUNNY_MIN_WORDS
from .prompts import FUNNY_PROMPT_DESC, FUNNY_RATING_DESCRIPTIONS


def find_funny_timestamps_batched(
    transcript_path: str | Path,
    *,
    min_rating: float = FUNNY_MIN_RATING,
    min_words: int = FUNNY_MIN_WORDS,
    return_all_stages: bool = False,
    **kwargs,
) -> List[ClipCandidate]:
    """Find humorous clip candidates using batched processing."""
    return find_clip_timestamps_batched(
        transcript_path,
        prompt_desc=FUNNY_PROMPT_DESC,
        min_rating=min_rating,
        rating_descriptions=FUNNY_RATING_DESCRIPTIONS,
        min_words=min_words,
        return_all_stages=return_all_stages,
        **kwargs,
    )


def find_funny_timestamps(
    transcript_path: str | Path,
    *,
    min_rating: float = FUNNY_MIN_RATING,
    min_words: int = FUNNY_MIN_WORDS,
    return_all_stages: bool = False,
    **kwargs,
) -> List[ClipCandidate]:
    """Find humorous clip candidates."""
    return find_clip_timestamps(
        transcript_path,
        prompt_desc=FUNNY_PROMPT_DESC,
        min_rating=min_rating,
        rating_descriptions=FUNNY_RATING_DESCRIPTIONS,
        min_words=min_words,
        return_all_stages=return_all_stages,
        **kwargs,
    )


__all__ = ["find_funny_timestamps_batched", "find_funny_timestamps"]
