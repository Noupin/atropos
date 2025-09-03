from pathlib import Path

from server.interfaces.clip_candidate import ClipCandidate
from server.steps.candidates.helpers import (
    export_candidates_json,
    load_candidates_json,
)


def test_rating_rounded_to_one_decimal(tmp_path: Path) -> None:
    cand = ClipCandidate(start=0.0, end=1.0, rating=8.66, reason="", quote="")
    path = tmp_path / "candidates.json"
    export_candidates_json([cand], path)
    loaded = load_candidates_json(path)
    assert loaded[0].rating == 8.7

