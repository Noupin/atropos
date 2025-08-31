import json
import re
import subprocess
from pathlib import Path
from typing import Iterable, List, Tuple

SILENCE_START_RE = re.compile(r"silence_start: (?P<time>\d+(?:\.\d+)?)")
SILENCE_END_RE = re.compile(r"silence_end: (?P<time>\d+(?:\.\d+)?)")

from ..config import (
    SILENCE_DETECTION_NOISE,
    SILENCE_DETECTION_MIN_DURATION,
)


def detect_silences(
    audio_path: str | Path,
    *,
    noise: str = SILENCE_DETECTION_NOISE,
    min_duration: float = SILENCE_DETECTION_MIN_DURATION,
) -> List[Tuple[float, float]]:
    """Return a list of (start, end) silence segments for ``audio_path``."""
    cmd = [
        "ffmpeg",
        "-i",
        str(audio_path),
        "-af",
        f"silencedetect=noise={noise}:d={min_duration}",
        "-f",
        "null",
        "-",
    ]
    proc = subprocess.run(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        check=True,
    )
    silences: List[Tuple[float, float]] = []
    start_time: float | None = None
    for line in proc.stderr.splitlines():
        m_start = SILENCE_START_RE.search(line)
        if m_start:
            start_time = float(m_start.group("time"))
            continue
        m_end = SILENCE_END_RE.search(line)
        if m_end and start_time is not None:
            end_time = float(m_end.group("time"))
            silences.append((start_time, end_time))
            start_time = None
    return silences


def write_silences_json(silences: Iterable[Tuple[float, float]], path: str | Path) -> None:
    data = [{"start": s, "end": e} for s, e in silences]
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f)


def load_silences_json(path: str | Path) -> List[Tuple[float, float]]:
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    return [(float(item["start"]), float(item["end"])) for item in data]


def snap_start_to_silence(start: float, silences: List[Tuple[float, float]]) -> float:
    """Snap ``start`` to the beginning of the preceding silence.

    The previous behaviour returned the end of the last silence before the
    clip.  This meant the clip began *after* the silence, effectively trimming
    quiet padding.  We instead want the clip to include that padding so we snap
    to the **start** of that silence.  If ``start`` already lies within a
    silence, we still snap to the start of that region.  If no preceding
    silence exists, ``start`` is returned unchanged.
    """

    for s_start, s_end in reversed(silences):
        # When the start falls within a silence or after one, snap to the
        # beginning of that silence to include the quiet lead-in.
        if s_start <= start:
            return s_start
    return start


def snap_end_to_silence(end: float, silences: List[Tuple[float, float]]) -> float:
    """Snap ``end`` to the conclusion of the following silence.

    Previously we snapped to the **start** of the next silence which cut off
    any trailing quiet section.  To extend clips through the silence we now
    snap to the silence's end.  If ``end`` already lies inside a silence, the
    end of that same silence is used.  When no subsequent silence exists, the
    original ``end`` is returned.
    """

    for s_start, s_end in silences:
        # If the clip ends before or inside this silence, extend to its end.
        if s_end >= end:
            return s_end
    return end

