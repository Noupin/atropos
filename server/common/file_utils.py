"""File helpers for pairing videos with captions."""

from __future__ import annotations

import mimetypes
from pathlib import Path
from typing import Iterator, Tuple


VIDEO_EXTS = {".mp4", ".mov", ".m4v"}


def _find_caption(video: Path) -> Path | None:
    prefer = video.with_name(f"{video.stem}_description.txt")
    if prefer.exists():
        return prefer
    fallback = video.with_suffix(".txt")
    if fallback.exists():
        return fallback
    return None


def iter_video_caption_pairs(folder: Path) -> Iterator[Tuple[Path, Path]]:
    """Yield ``(video, caption)`` pairs under ``folder``."""

    for video in sorted(folder.iterdir()):
        if video.suffix.lower() not in VIDEO_EXTS:
            continue
        mime, _ = mimetypes.guess_type(str(video))
        if not mime or not mime.startswith("video"):
            continue
        caption = _find_caption(video)
        if caption:
            yield video, caption


__all__ = ["iter_video_caption_pairs", "VIDEO_EXTS"]

