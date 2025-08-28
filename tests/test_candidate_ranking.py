from __future__ import annotations

from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "server"))

from server.steps.candidates.helpers import _enforce_non_overlap
from server.interfaces.clip_candidate import ClipCandidate


def test_tone_aligned_prioritized() -> None:
    items = [(0.0, 12.0, "A"), (12.0, 24.0, "B")]
    good = ClipCandidate(start=0.0, end=1.0, rating=5.0, reason="", quote="")
    bad = ClipCandidate(start=0.0, end=1.0, rating=9.0, reason="", quote="")
    good.tone_match = True
    bad.tone_match = False

    result = _enforce_non_overlap([bad, good], items)
    assert len(result) == 1
    chosen = result[0]
    assert chosen.rating == good.rating
    assert chosen.start == 0.0 and chosen.end == 12.0


def test_shorter_clip_preferred() -> None:
    """When multiple valid clips overlap, prefer the shorter option."""
    items = [
        (0.0, 4.0, "A"),
        (4.0, 8.0, "B"),
        (8.0, 12.0, "C"),
        (12.0, 16.0, "D"),
        (16.0, 20.0, "E"),
        (20.0, 24.0, "F"),
    ]
    short = ClipCandidate(start=0.0, end=11.0, rating=7.0, reason="", quote="")
    long = ClipCandidate(start=0.0, end=23.0, rating=7.0, reason="", quote="")
    result = _enforce_non_overlap([long, short], items)
    assert len(result) == 1
    chosen = result[0]
    assert chosen.start == 0.0 and chosen.end == 12.0


def test_short_clips_discarded() -> None:
    items = [(0.0, 5.0, "A"), (5.0, 10.0, "B")]
    short = ClipCandidate(start=0.0, end=4.0, rating=8.0, reason="", quote="")
    result = _enforce_non_overlap([short], items, min_duration_seconds=10.0)
    assert result == []


def test_clips_under_ten_seconds_excluded() -> None:
    items = [
        (0.0, 4.0, "A"),
        (4.0, 8.0, "B"),
        (8.0, 12.0, "C"),
        (12.0, 20.0, "D"),
    ]
    short = ClipCandidate(start=0.0, end=5.0, rating=7.0, reason="", quote="")
    long = ClipCandidate(start=0.0, end=14.0, rating=7.0, reason="", quote="")
    result = _enforce_non_overlap([short, long], items, min_duration_seconds=10.0)
    assert len(result) == 1
    chosen = result[0]
    assert chosen.start == 0.0 and chosen.end == 20.0
