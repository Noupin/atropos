from __future__ import annotations

from pathlib import Path
from typing import List

from . import find_clip_timestamps_batched, find_clip_timestamps, ClipCandidate
from .prompts import INSPIRING_PROMPT_DESC


def find_inspiring_timestamps_batched(
    transcript_path: str | Path,
    *args,
    **kwargs,
) -> List[ClipCandidate]:
    """Find inspiring clip candidates using batched processing."""
    return find_clip_timestamps_batched(
        transcript_path, prompt_desc=INSPIRING_PROMPT_DESC, **kwargs
    )


def find_inspiring_timestamps(
    transcript_path: str | Path,
    *args,
    **kwargs,
) -> List[ClipCandidate]:
    """Find inspiring clip candidates."""
    return find_clip_timestamps(
        transcript_path, prompt_desc=INSPIRING_PROMPT_DESC, **kwargs
    )


__all__ = ["find_inspiring_timestamps_batched", "find_inspiring_timestamps"]
