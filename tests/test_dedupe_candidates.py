from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "server"))

from server.steps.candidates.helpers import dedupe_candidates
from server.interfaces.clip_candidate import ClipCandidate


def test_dedupe_keeps_highest_rating() -> None:
    dup1 = ClipCandidate(start=1.0, end=2.0, rating=5.0, reason="", quote="")
    dup2 = ClipCandidate(start=1.0, end=2.0, rating=8.0, reason="", quote="")
    result = dedupe_candidates([dup1, dup2])
    assert len(result) == 1
    chosen = result[0]
    assert chosen.rating == 8.0
    assert chosen.start == 1.0 and chosen.end == 2.0
