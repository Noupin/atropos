from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "server"))

from server.steps.candidates.refine import (
    duration_score,
    refine_clip_window,
)


def test_duration_score() -> None:
    assert duration_score(10.0) == 1.0
    assert duration_score(4.0) < 1.0
    assert duration_score(40.0) < 1.0


def test_refine_clip_window() -> None:
    items = [(0.0, 1.0, "a"), (1.2, 3.0, "b")]
    words = [
        {"start": 0.0, "end": 0.5},
        {"start": 0.5, "end": 1.0},
        {"start": 1.2, "end": 2.0},
        {"start": 2.0, "end": 3.0},
    ]
    silences = [(1.0, 1.2), (3.0, 3.5)]
    s, e = refine_clip_window(0.6, 2.5, items, words=words, silences=silences)
    assert s == 0.0
    assert e == 2.55
