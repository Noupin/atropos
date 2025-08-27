from __future__ import annotations

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "server"))

from server.steps.cut import save_clip, save_clip_from_candidate
from server.interfaces.clip_candidate import ClipCandidate


def test_cut_duration_respects_start(tmp_path: Path) -> None:
    """Clips starting mid-video should have the expected length."""

    source = tmp_path / "src.mp4"
    subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "color=c=black:s=16x16",
            "-t",
            "5",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            str(source),
        ],
        check=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )

    clip = tmp_path / "clip.mp4"
    assert save_clip(source, clip, start=1.0, end=3.0, reencode=True)

    probe = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            str(clip),
        ],
        check=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    duration = float(probe.stdout.decode().strip())
    assert 1.9 <= duration <= 2.1


def test_clip_snaps_to_word_boundaries(tmp_path: Path) -> None:
    """save_clip_from_candidate should honour provided word timings."""

    source = tmp_path / "src.mp4"
    subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "color=c=black:s=16x16",
            "-t",
            "5",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            str(source),
        ],
        check=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )

    transcript = tmp_path / "tx.txt"
    transcript.write_text("[0.00 -> 5.00] hello world\n", encoding="utf-8")

    cand = ClipCandidate(start=1.2, end=2.3, rating=9.0, reason="", quote="")
    words = [
        {"start": 1.0, "end": 1.5, "text": "hello"},
        {"start": 2.0, "end": 2.5, "text": "world"},
    ]
    silences = [(0.0, 0.75), (2.95, 5.0)]

    out = save_clip_from_candidate(
        source,
        tmp_path,
        cand,
        transcript_path=transcript,
        words=words,
        silences=silences,
        reencode=True,
    )
    assert out is not None
    assert "1.00-2.50" in out.name

    probe = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            str(out),
        ],
        check=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    duration = float(probe.stdout.decode().strip())
    assert 1.45 <= duration <= 1.55

