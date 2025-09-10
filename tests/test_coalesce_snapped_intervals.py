from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "server"))

from server.steps.candidates.helpers import _coalesce_snapped_intervals
from server.interfaces.clip_candidate import ClipCandidate


def test_coalesce_merges_and_prefers_higher_rating(capsys) -> None:
    c1 = ClipCandidate(start=0.0, end=1.0, rating=None, reason="r1", quote="q1")
    c2 = ClipCandidate(start=0.8, end=2.0, rating=5.0, reason="r2", quote="q2")
    c3 = ClipCandidate(start=3.0, end=4.0, rating=1.0, reason="r3", quote="q3")

    # Input intentionally unsorted
    result = _coalesce_snapped_intervals([c3, c1, c2])

    assert len(result) == 2
    merged, solo = result

    assert merged.start == 0.0
    assert merged.end == 2.0
    assert merged.rating == 5.0
    assert merged.reason == "r2"
    assert merged.quote == "q2"

    assert solo.start == 3.0
    assert solo.end == 4.0
    assert solo.rating == 1.0

    out = capsys.readouterr().out
    assert "[Coalesce] before=3 after=2 merged=1" in out
