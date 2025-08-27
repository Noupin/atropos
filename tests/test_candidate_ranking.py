from __future__ import annotations

from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "server"))

from server.steps.candidates.helpers import _enforce_non_overlap
from server.interfaces.clip_candidate import ClipCandidate


def test_tone_aligned_prioritized() -> None:
    items = [(0.0, 2.0, "a"), (2.0, 4.0, "b")]
    good = ClipCandidate(start=0.0, end=1.0, rating=5.0, reason="", quote="")
    bad = ClipCandidate(start=0.0, end=1.0, rating=9.0, reason="", quote="")
    good.tone_match = True
    bad.tone_match = False

    result = _enforce_non_overlap([bad, good], items)
    assert len(result) == 1
    chosen = result[0]
    assert chosen.rating == good.rating
    assert chosen.start == 0.0 and chosen.end == 4.0
