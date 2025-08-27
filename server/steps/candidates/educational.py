from __future__ import annotations

from pathlib import Path
from typing import List

from . import find_clip_timestamps_batched, find_clip_timestamps, ClipCandidate
from .prompts import EDUCATIONAL_PROMPT_DESC


def find_educational_timestamps_batched(
    transcript_path: str | Path,
    *,
    min_rating: float = 7.0,
    min_words: int = 8,
    **kwargs,
) -> List[ClipCandidate]:
    """Find educational clip candidates using batched processing."""
    return find_clip_timestamps_batched(
        transcript_path,
        prompt_desc=EDUCATIONAL_PROMPT_DESC,
        min_rating=min_rating,
        min_words=min_words,
        **kwargs,
    )


def find_educational_timestamps(
    transcript_path: str | Path,
    *,
    min_rating: float = 7.0,
    min_words: int = 8,
    **kwargs,
) -> List[ClipCandidate]:
    """Find educational clip candidates."""
    return find_clip_timestamps(
        transcript_path,
        prompt_desc=EDUCATIONAL_PROMPT_DESC,
        min_rating=min_rating,
        min_words=min_words,
        **kwargs,
    )


__all__ = ["find_educational_timestamps_batched", "find_educational_timestamps"]
