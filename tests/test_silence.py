from __future__ import annotations

import subprocess
from pathlib import Path
import sys

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "server"))

from server.steps.silence import (
    detect_silences,
    snap_start_to_silence,
    snap_end_to_silence,
)
from server.steps.candidates.helpers import snap_to_silence


def _make_audio(path: Path) -> None:
    """Create 1s tone, 0.5s silence, 1s tone."""
    subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=1000:duration=1",
            "-f",
            "lavfi",
            "-i",
            "anullsrc=r=48000:cl=mono:duration=0.5",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=1000:duration=1",
            "-filter_complex",
            "[0:a][1:a][2:a]concat=n=3:v=0:a=1[out]",
            "-map",
            "[out]",
            "-c:a",
            "pcm_s16le",
            str(path),
        ],
        check=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )


def test_detect_silences(tmp_path: Path) -> None:
    audio = tmp_path / "test.wav"
    _make_audio(audio)
    silences = detect_silences(str(audio), noise="-20dB", min_duration=0.3)
    assert any(0.9 < s < 1.1 and 1.3 < e < 1.6 for s, e in silences)


def test_snap_helpers() -> None:
    silences = [(0.0, 1.0), (5.0, 6.0)]
    # ``snap_start_to_silence`` should extend to the beginning of the previous
    # silent segment so the leading silence is preserved.
    assert snap_start_to_silence(2.5, silences) == 0.0
    # ``snap_end_to_silence`` should extend through the following silent segment
    # ensuring trailing silence remains.
    assert snap_end_to_silence(4.0, silences) == 6.0


def test_snap_helpers_accept_str() -> None:
    """Both helpers should handle string inputs gracefully."""
    silences = [(0.0, 1.0), (5.0, 6.0)]
    assert snap_start_to_silence("2.5", silences) == 0.0
    assert snap_end_to_silence("4.0", silences) == 6.0


def test_snap_to_silence_includes_padding() -> None:
    """``snap_to_silence`` adds leading and trailing silence for a clip."""
    silences = [(0.0, 1.0), (5.0, 6.0)]
    s, e = snap_to_silence(1.0, 5.0, silences)
    assert s == pytest.approx(0.75)
    assert e == pytest.approx(5.45)
