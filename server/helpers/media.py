"""Media helper utilities for probing file metadata."""

from __future__ import annotations

import json
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Optional


@dataclass(frozen=True)
class VideoStreamMetadata:
    """Lightweight metadata describing the primary video stream."""

    width: Optional[int]
    height: Optional[int]
    duration: Optional[float]
    frame_rate: Optional[float]


def probe_media_duration(path: str | Path) -> Optional[float]:
    """Return the duration of ``path`` in seconds using ``ffprobe`` when available."""

    try:
        result = subprocess.run(
            [
                "ffprobe",
                "-v",
                "error",
                "-show_entries",
                "format=duration",
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


def _parse_frame_rate(value: str | int | float | None) -> Optional[float]:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        try:
            numeric = float(value)
        except (TypeError, ValueError):
            return None
        return numeric if numeric > 0 else None
    if isinstance(value, str):
        if "/" in value:
            numerator, denominator = value.split("/", 1)
            try:
                num = float(numerator)
                den = float(denominator)
            except ValueError:
                return None
            if den == 0:
                return None
            return num / den
        try:
            numeric = float(value)
        except ValueError:
            return None
        return numeric if numeric > 0 else None
    return None


def probe_video_stream(path: str | Path) -> VideoStreamMetadata:
    """Return resolution, duration, and frame rate metadata for ``path``."""

    try:
        result = subprocess.run(
            [
                "ffprobe",
                "-v",
                "error",
                "-select_streams",
                "v:0",
                "-show_entries",
                "stream=width,height,avg_frame_rate",
                "-show_entries",
                "format=duration",
                "-of",
                "json",
                str(path),
            ],
            check=True,
            text=True,
            capture_output=True,
        )
    except (FileNotFoundError, subprocess.CalledProcessError):
        return VideoStreamMetadata(width=None, height=None, duration=None, frame_rate=None)

    try:
        payload = json.loads(result.stdout or "{}")
    except json.JSONDecodeError:
        return VideoStreamMetadata(width=None, height=None, duration=None, frame_rate=None)

    width: Optional[int] = None
    height: Optional[int] = None
    frame_rate: Optional[float] = None
    duration: Optional[float] = None

    streams = payload.get("streams")
    if isinstance(streams, list) and streams:
        stream = streams[0]
        if isinstance(stream, dict):
            raw_width = stream.get("width")
            raw_height = stream.get("height")
            width = int(raw_width) if isinstance(raw_width, (int, float)) else None
            height = int(raw_height) if isinstance(raw_height, (int, float)) else None
            frame_rate = _parse_frame_rate(stream.get("avg_frame_rate"))

    fmt = payload.get("format")
    if isinstance(fmt, dict):
        raw_duration = fmt.get("duration")
        if isinstance(raw_duration, (int, float)):
            try:
                numeric = float(raw_duration)
            except (TypeError, ValueError):
                numeric = None
        elif isinstance(raw_duration, str):
            try:
                numeric = float(raw_duration)
            except ValueError:
                numeric = None
        else:
            numeric = None
        if numeric is not None and numeric > 0:
            duration = numeric

    return VideoStreamMetadata(width=width, height=height, duration=duration, frame_rate=frame_rate)


__all__ = ["VideoStreamMetadata", "probe_media_duration", "probe_video_stream"]
