"""Media helper utilities for probing file metadata."""

from __future__ import annotations

import subprocess
from pathlib import Path
from typing import Optional


def probe_media_duration(path: str | Path) -> Optional[float]:
    """Return the duration of ``path`` in seconds using ``ffprobe`` when available."""

    try:
        result = subprocess.run(
            [
                "ffprobe",
                "-v",
                "error",
                "-select_streams",
                "a:0",
                "-show_entries",
                "stream=duration",
                "-of",
                "default=noprint_wrappers=1:nokey=1",
                str(path),
            ],
            check=True,
            text=True,
            capture_output=True,
        )
    except (FileNotFoundError, subprocess.CalledProcessError):
        return None

    output = (result.stdout or "").strip()
    if not output:
        return None

    try:
        return float(output)
    except ValueError:
        return None
