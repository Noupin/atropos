from __future__ import annotations

from pathlib import Path
from typing import Any, List

from . import ClipCandidate
from .tone import Tone, find_candidates_by_tone


def find_funny_timestamps(
    transcript_path: str | Path,
    **kwargs: Any,
) -> List[ClipCandidate]:
    """Backward-compatible wrapper for ``Tone.FUNNY``."""
    return find_candidates_by_tone(transcript_path, tone=Tone.FUNNY, **kwargs)


find_funny_timestamps_batched = find_funny_timestamps


__all__ = ["find_funny_timestamps", "find_funny_timestamps_batched"]

