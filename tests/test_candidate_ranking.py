from __future__ import annotations

from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "server"))

from server.steps.candidates.helpers import _enforce_non_overlap, refine_clip_window
from server.interfaces.clip_candidate import ClipCandidate
from server.custom_types.tone import ToneStrategy
import config


DEFAULT_STRATEGY = ToneStrategy(prompt_desc="")


def test_tone_aligned_prioritized() -> None:
    items = [(0.0, 12.0, "A"), (12.0, 24.0, "B")]
    good = ClipCandidate(start=0.0, end=1.0, rating=5.0, reason="", quote="")
    bad = ClipCandidate(start=0.0, end=1.0, rating=9.0, reason="", quote="")
    good.tone_match = True
    bad.tone_match = False

    result = _enforce_non_overlap([bad, good], items, strategy=DEFAULT_STRATEGY)
    assert len(result) == 1
    chosen = result[0]
    assert chosen.rating == 7.0
    assert chosen.count == 2
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
    result = _enforce_non_overlap([long, short], items, strategy=DEFAULT_STRATEGY)
    assert len(result) == 1
    chosen = result[0]
    assert chosen.start == 0.0 and chosen.end == 12.0


def test_short_clips_discarded() -> None:
    items = [(0.0, 5.0, "A"), (5.0, 10.0, "B")]
    short = ClipCandidate(start=0.0, end=4.0, rating=8.0, reason="", quote="")
    result = _enforce_non_overlap(
        [short], items, strategy=DEFAULT_STRATEGY, min_duration_seconds=10.0
    )
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
    result = _enforce_non_overlap(
        [short, long], items, strategy=DEFAULT_STRATEGY, min_duration_seconds=10.0
    )
    assert len(result) == 1
    chosen = result[0]
    assert chosen.start == 0.0 and chosen.end == 20.0


def test_min_rating_excludes_low_scores() -> None:
    items = [(0.0, 5.0, "A"), (5.0, 10.0, "B")]
    low = ClipCandidate(start=0.0, end=5.0, rating=4.0, reason="", quote="")
    high = ClipCandidate(start=5.0, end=10.0, rating=6.0, reason="", quote="")
    result = _enforce_non_overlap(
        [low, high], items, strategy=DEFAULT_STRATEGY, min_rating=5.0
    )
    assert len(result) == 1
    assert result[0].rating == 6.0


def test_enforce_non_overlap_respects_config(monkeypatch) -> None:
    items = [(0.0, 10.0, "A"), (10.0, 20.0, "B")]
    first = ClipCandidate(start=0.0, end=9.0, rating=9.0, reason="", quote="")
    second = ClipCandidate(start=8.0, end=18.0, rating=8.5, reason="", quote="")
    monkeypatch.setattr(config, "ENFORCE_NON_OVERLAP", False)
    result = _enforce_non_overlap(
        [first, second],
        items,
        strategy=DEFAULT_STRATEGY,
        min_duration_seconds=0.0,
        min_rating=0.0,
    )
    assert result == [first, second]


def test_repeated_quotes_extend_end() -> None:
    """Repeated quotes should extend the refined window to the last occurrence."""
    items = [
        (0.0, 1.0, "Hello"),
        (1.0, 2.0, "Hello"),
        (2.0, 3.0, "Hello"),
        (3.0, 4.0, "Done"),
    ]
    cand = ClipCandidate(start=0.0, end=1.0, rating=5.0, reason="", quote="Hello")
    s, e = refine_clip_window(
        cand.start, cand.end, items, strategy=DEFAULT_STRATEGY, quote=cand.quote
    )
    assert s == 0.0
    assert e == 3.0
