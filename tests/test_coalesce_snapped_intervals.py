from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "server"))

from server.steps.candidates.helpers import _coalesce_snapped_intervals
from server.interfaces.clip_candidate import ClipCandidate


def make_candidate(start: float, end: float, rating: float) -> ClipCandidate:
    """Convenience helper to build clip candidates."""
    return ClipCandidate(start=start, end=end, rating=rating, reason="r", quote="q")


def test_touching_intervals_merge_and_keep_top_rating() -> None:
    c1 = make_candidate(0.0, 1.0, 3.0)
    c2 = make_candidate(1.0, 2.0, 5.0)
    c3 = make_candidate(3.0, 4.0, 1.0)

    # Input intentionally unsorted
    result = _coalesce_snapped_intervals([c3, c1, c2])

    assert len(result) == 2
    merged, solo = result

    assert merged.start == 0.0
    assert merged.end == 2.0
    assert merged.rating == 5.0

    assert solo.start == 3.0
    assert solo.end == 4.0
    assert solo.rating == 1.0


def test_gap_greater_than_eps_remains_separate() -> None:
    c1 = make_candidate(0.0, 1.0, 1.0)
    c2 = make_candidate(1.01, 2.0, 2.0)

    result = _coalesce_snapped_intervals([c1, c2])

    assert len(result) == 2
    first, second = result
    assert first.start == 0.0
    assert first.end == 1.0
    assert second.start == 1.01
    assert second.end == 2.0


def test_near_touching_within_eps_merges() -> None:
    eps = 1e-3
    c1 = make_candidate(0.0, 1.0, 1.0)
    c2 = make_candidate(1.0 + eps / 2, 2.0, 4.0)

    result = _coalesce_snapped_intervals([c1, c2], eps=eps)

    assert len(result) == 1
    merged = result[0]
    assert merged.start == 0.0
    assert merged.end == 2.0
    assert merged.rating == 4.0

