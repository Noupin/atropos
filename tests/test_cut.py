from __future__ import annotations

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "server"))

from server.steps.cut import save_clip, save_clip_from_candidate
from server.steps.candidates import ClipCandidate


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


def test_save_clip_from_candidate_truncates(tmp_path: Path) -> None:
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

    candidate = ClipCandidate(start=0.0, end=4.0, rating=8.0, reason="", quote="")
    clip_dir = tmp_path / "clips"
    clip_dir.mkdir()
    out = save_clip_from_candidate(
        source,
        clip_dir,
        candidate,
        reencode=True,
        max_duration_seconds=1.5,
    )
    assert out is not None
    assert 1.4 <= candidate.end <= 1.6

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
    assert 1.4 <= duration <= 1.6

