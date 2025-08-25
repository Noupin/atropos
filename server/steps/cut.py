from __future__ import annotations

import subprocess
import time
from pathlib import Path
from typing import Optional

from interfaces.clip_candidate import ClipCandidate


def save_clip(
    video_path: str | Path,
    output_path: str | Path,
    *,
    start: float,
    end: Optional[float] = None,
    duration: Optional[float] = None,
    reencode: bool = False,
    extra_ffmpeg_args: Optional[list[str]] = None,
) -> bool:
    """Save a single clip from `video_path` to `output_path`.

    If `reencode=False`, we try stream copy for speed (may be slightly off by keyframes).
    If `reencode=True`, we re-encode with H.264/AAC for frame-accurate cuts.
    """
    vp = Path(video_path)
    op = Path(output_path)
    op.parent.mkdir(parents=True, exist_ok=True)

    if not vp.exists():
        print(f"FFMPEG: source not found: {vp}")
        return False

    if (end is None) == (duration is None):
        raise ValueError("Provide exactly one of `end` or `duration`.")

    if end is None:
        end = max(0.0, start + float(duration))
    if end <= start:
        print("FFMPEG: invalid range (end <= start)")
        return False

    # Build ffmpeg command
    # Use -ss before -i for fast seek; for reencode we also put -ss after -i for accuracy.
    base = [
        "ffmpeg",
        "-y",
        "-ss", f"{start:.3f}",
        "-i", str(vp),
    ]

    if reencode:
        base += [
            "-to", f"{end:.3f}",
            "-c:v", "libx264",
            "-preset", "veryfast",
            "-crf", "18",
            "-c:a", "aac",
            "-movflags", "+faststart",
        ]
    else:
        # stream copy; some containers ignore -to unless after -i, but this works for mp4 typically
        base += [
            "-to", f"{end:.3f}",
            "-c", "copy",
            "-movflags", "+faststart",
        ]

    if extra_ffmpeg_args:
        base += list(extra_ffmpeg_args)

    base.append(str(op))

    t0 = time.time()
    try:
        proc = subprocess.run(base, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True)
        dt = time.time() - t0
        print(f"FFMPEG: wrote {op.name} in {dt:.2f}s")
        return True
    except subprocess.CalledProcessError as e:
        dt = time.time() - t0
        print(f"FFMPEG: failed in {dt:.2f}s -> {e}\nSTDERR:\n{e.stderr.decode(errors='ignore')[:500]}")
        return False



def save_clip_from_candidate(video_path: str | Path, output_dir: str | Path, candidate: ClipCandidate, *, reencode: bool = False) -> Path | None:
    """Convenience wrapper that names the clip using timestamps and rating."""
    out = Path(output_dir) / f"clip_{candidate.start:.2f}-{candidate.end:.2f}_r{candidate.rating:.1f}.mp4"
    ok = save_clip(video_path, out, start=candidate.start, end=candidate.end, reencode=reencode)
    return out if ok else None

