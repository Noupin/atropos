import json
import re
import subprocess
from pathlib import Path
from typing import Callable, Iterable, List, Tuple

SILENCE_START_RE = re.compile(r"silence_start: (?P<time>\d+(?:\.\d+)?)")
SILENCE_END_RE = re.compile(r"silence_end: (?P<time>\d+(?:\.\d+)?)")

from config import (
    SILENCE_DETECTION_NOISE,
    SILENCE_DETECTION_MIN_DURATION,
)


def detect_silences(
    audio_path: str | Path,
    *,
    noise: str = SILENCE_DETECTION_NOISE,
    min_duration: float = SILENCE_DETECTION_MIN_DURATION,
    progress_callback: Callable[[float, float], None] | None = None,
    duration_hint: float | None = None,
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
    proc = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    silences: List[Tuple[float, float]] = []
    start_time: float | None = None
    assert proc.stderr is not None
    for line in proc.stderr:
        m_start = SILENCE_START_RE.search(line)
        if m_start:
            start_time = float(m_start.group("time"))
            continue
        m_end = SILENCE_END_RE.search(line)
        if m_end and start_time is not None:
            end_time = float(m_end.group("time"))
            silences.append((start_time, end_time))
            if progress_callback and duration_hint:
                fraction = min(0.99, max(0.0, end_time / duration_hint))
                progress_callback(fraction, end_time)
            start_time = None
    proc.wait()
    if progress_callback:
        progress_callback(1.0, duration_hint or 0.0)
    if proc.returncode and proc.returncode != 0:
        raise subprocess.CalledProcessError(proc.returncode, cmd)
    return silences


def write_silences_json(silences: Iterable[Tuple[float, float]], path: str | Path) -> None:
    data = [{"start": s, "end": e} for s, e in silences]
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f)


def load_silences_json(path: str | Path) -> List[Tuple[float, float]]:
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    return [(float(item["start"]), float(item["end"])) for item in data]


def snap_start_to_silence(start: float | str, silences: List[Tuple[float, float]]) -> float:
    """Snap ``start`` to the beginning of the preceding silence.

    ``start`` may be provided as either a ``float`` or a string representing a
    float.  The value is coerced to ``float`` to tolerate inputs loaded from
    JSON.  The previous behaviour returned the end of the last silence before
    the clip.  This meant the clip began *after* the silence, effectively
    trimming quiet padding.  We instead want the clip to include that padding so
    we snap to the **start** of that silence.  If ``start`` already lies within
    a silence, we still snap to the start of that region.  If no preceding
    silence exists, ``start`` is returned unchanged.
    """

    try:
        start_val = float(start)
    except (TypeError, ValueError) as exc:
        raise TypeError(f"start must be float-like, got {start!r}") from exc

    for s_start, _ in reversed(silences):
        # When the start falls within a silence or after one, snap to the
        # beginning of that silence to include the quiet lead-in.
        if s_start <= start_val:
            return s_start
    return start_val


def snap_end_to_silence(end: float | str, silences: List[Tuple[float, float]]) -> float:
    """Snap ``end`` to the conclusion of the following silence.

    ``end`` may be provided as either a ``float`` or a string representing a
    float.  It is coerced to ``float`` so values read from JSON files are
    handled seamlessly.  Previously we snapped to the **start** of the next
    silence which cut off any trailing quiet section.  To extend clips through
    the silence we now snap to the silence's end.  If ``end`` already lies
    inside a silence, the end of that same silence is used.  When no subsequent
    silence exists, the original ``end`` is returned.
    """

    try:
        end_val = float(end)
    except (TypeError, ValueError) as exc:
        raise TypeError(f"end must be float-like, got {end!r}") from exc

    for _, s_end in silences:
        # If the clip ends before or inside this silence, extend to its end.
        if s_end >= end_val:
            return s_end
    return end_val

