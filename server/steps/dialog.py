import json
from pathlib import Path
from typing import Iterable, List, Tuple

from .candidates.helpers import parse_transcript

_KEYWORDS = {"haha", "lol", "joke", "laugh", "laughter"}


def detect_dialog_ranges(transcript_path: str | Path, *, gap: float = 1.0) -> List[Tuple[float, float]]:
    """Detect conversational or joke segments within ``transcript_path``.

    The transcript is expected to contain lines formatted as
    ``[start -> end] text``.  A simple heuristic is used: any line containing a
    question mark, an exclamation mark, or one of several laugh-related
    keywords is marked as dialog.  Consecutive dialog lines, or ones separated
    by ``gap`` seconds or less, are merged into a single range.
    """

    items = parse_transcript(transcript_path)
    ranges: List[Tuple[float, float]] = []
    current_start: float | None = None
    current_end: float | None = None

    for start, end, text in items:
        lowered = text.lower()
        is_dialog = (
            "?" in text
            or "!" in text
            or any(key in lowered for key in _KEYWORDS)
        )
        if is_dialog:
            if current_start is None:
                current_start, current_end = start, end
            elif start - current_end <= gap:
                current_end = end
            else:
                ranges.append((current_start, current_end))
                current_start, current_end = start, end
        else:
            if current_start is not None:
                ranges.append((current_start, current_end))
                current_start, current_end = None, None

    if current_start is not None:
        ranges.append((current_start, current_end))

    return ranges


def write_dialog_ranges_json(ranges: Iterable[Tuple[float, float]], path: str | Path) -> None:
    """Write ``ranges`` to ``path`` in JSON format."""
    data = [{"start": s, "end": e} for s, e in ranges]
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f)


def load_dialog_ranges_json(path: str | Path) -> List[Tuple[float, float]]:
    """Load dialog ranges from a JSON file previously written by
    :func:`write_dialog_ranges_json`."""
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    return [(float(item["start"]), float(item["end"])) for item in data]
