from __future__ import annotations

from pathlib import Path
from typing import List, Tuple
import re

__all__ = ["parse_transcript"]

_TIME_RANGE = re.compile(
    r"^\[(?P<start>\d+(?:\.\d+)?)\s*->\s*(?P<end>\d+(?:\.\d+)?)\]\s*(?P<text>.*)$"
)


def parse_transcript(transcript_path: str | Path) -> List[Tuple[float, float, str]]:
    """Read a transcript .txt with lines like: `[12.34 -> 17.89] text`.
    Returns list of ``(start, end, text)`` tuples."""
    items: List[Tuple[float, float, str]] = []
    p = Path(transcript_path)
    if not p.exists():
        raise FileNotFoundError(f"Transcript not found: {transcript_path}")
    with p.open("r", encoding="utf-8") as f:
        for line in f:
            m = _TIME_RANGE.match(line.strip())
            if not m:
                continue
            start = float(m.group("start"))
            end = float(m.group("end"))
            text = m.group("text").strip()
            if text:
                items.append((start, end, text))
    return items
