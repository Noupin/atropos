"""Lightweight SRT parsing utilities for project exports."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Iterator


@dataclass(frozen=True)
class SubtitleCue:
    """Represents a single subtitle entry parsed from an SRT file."""

    start: float
    end: float
    text: str


def _iter_srt_blocks(content: str) -> Iterator[list[str]]:
    current: list[str] = []
    for line in content.splitlines():
        stripped = line.strip("\ufeff ")
        if stripped == "":
            if current:
                yield current
                current = []
            continue
        current.append(stripped)
    if current:
        yield current


def _parse_timecode(token: str) -> tuple[float, float] | None:
    try:
        start_part, end_part = token.split("-->")
    except ValueError:
        return None
    start_seconds = _parse_timestamp(start_part.strip())
    end_seconds = _parse_timestamp(end_part.strip())
    if start_seconds is None or end_seconds is None:
        return None
    if end_seconds <= start_seconds:
        return None
    return start_seconds, end_seconds


def _parse_timestamp(value: str) -> float | None:
    try:
        hours, minutes, seconds = value.split(":")
        seconds_value, _, milliseconds = seconds.partition(",")
        total = (int(hours) * 3600) + (int(minutes) * 60) + int(seconds_value)
        if milliseconds:
            total += int(milliseconds) / 1000.0
        return float(total)
    except (ValueError, TypeError):
        return None


def parse_srt(content: str) -> list[SubtitleCue]:
    """Parse ``content`` into a list of :class:`SubtitleCue` items."""

    cues: list[SubtitleCue] = []
    for block in _iter_srt_blocks(content):
        if not block:
            continue
        if block[0].isdigit():
            block = block[1:]
        if not block:
            continue
        timing = _parse_timecode(block[0])
        if timing is None:
            continue
        start_seconds, end_seconds = timing
        text = " ".join(entry for entry in block[1:] if entry).strip()
        if not text:
            continue
        cues.append(SubtitleCue(start=start_seconds, end=end_seconds, text=text))
    return cues


def parse_srt_file(path: Path) -> list[SubtitleCue]:
    """Read ``path`` and parse subtitles when the file exists."""

    try:
        content = path.read_text(encoding="utf-8")
    except OSError:
        return []
    return parse_srt(content)


__all__ = ["SubtitleCue", "parse_srt", "parse_srt_file"]
