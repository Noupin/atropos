from __future__ import annotations

from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from server.steps.candidates.manifest import export_candidates_json, load_candidates_json
from server.interfaces.clip_candidate import ClipCandidate


def test_manifest_roundtrip(tmp_path: Path) -> None:
    cands = [
        ClipCandidate(start=0.0, end=1.0, rating=5.0, reason="a", quote="b"),
        ClipCandidate(start=1.0, end=2.0, rating=6.0, reason="c", quote="d"),
    ]
    path = tmp_path / "c.json"
    export_candidates_json(cands, path)
    loaded = load_candidates_json(path)
    assert loaded == cands
