from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "server"))

from server.steps.candidates.silence import (
    parse_ffmpeg_silences,
    snap_to_silence,
    snap_to_word_boundaries,
)


def test_parse_ffmpeg_silences() -> None:
    log = """
    [silencedetect @ abc] silence_start: 1.0
    [silencedetect @ abc] silence_end: 3.0 | silence_duration: 2.0
    """
    assert parse_ffmpeg_silences(log) == [(1.0, 3.0)]


def test_snap_helpers() -> None:
    silences = [(1.0, 1.5), (3.0, 3.5)]
    s, e = snap_to_silence(2.0, 2.5, silences)
    assert s == 1.75 and e == 2.55

    words = [
        {"start": 1.4, "end": 1.6, "text": "hi"},
        {"start": 2.4, "end": 2.6, "text": "bye"},
    ]
    assert snap_to_word_boundaries(1.45, 2.55, words) == (1.4, 2.6)
