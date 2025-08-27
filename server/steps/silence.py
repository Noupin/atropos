import json
import re
import subprocess
from pathlib import Path
from typing import Iterable, List, Tuple

SILENCE_START_RE = re.compile(r"silence_start: (?P<time>\d+(?:\.\d+)?)")
SILENCE_END_RE = re.compile(r"silence_end: (?P<time>\d+(?:\.\d+)?)")


def detect_silences(
    audio_path: str | Path,
    *,
    noise: str = "-30dB",
    min_duration: float = 0.3,
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
    for s_start, s_end in reversed(silences):
        if s_end <= start:
            return s_end
    return start


def snap_end_to_silence(end: float, silences: List[Tuple[float, float]]) -> float:
    for s_start, s_end in silences:
        if s_start >= end:
            return s_start
    return end

