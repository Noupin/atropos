"""Helpers for writing native editor project formats."""

from __future__ import annotations

from pathlib import Path
from typing import Iterable, Mapping, Sequence

from xml.etree import ElementTree as ET


FRAME_RATE_TOLERANCE = 1e-3


def _fps_to_timebase(fps: float) -> tuple[int, str]:
    """Return Premiere timebase integer and ntsc flag."""

    if fps <= 0:
        return 24, "FALSE"
    ntsc = abs(fps - 29.97) < FRAME_RATE_TOLERANCE or abs(fps - 59.94) < FRAME_RATE_TOLERANCE
    return int(round(fps)), "TRUE" if ntsc else "FALSE"


def _build_rate_element(parent: ET.Element, fps: float) -> None:
    timebase, ntsc = _fps_to_timebase(fps)
    rate_el = ET.SubElement(parent, "rate")
    ET.SubElement(rate_el, "timebase").text = str(timebase)
    ET.SubElement(rate_el, "ntsc").text = ntsc


def _append_log_info(parent: ET.Element) -> None:
    logging_info = ET.SubElement(parent, "logginginfo")
    for tag in ("description", "scene", "shottake", "lognote"):
        ET.SubElement(logging_info, tag).text = ""


def generate_premiere_project(
    *,
    clip_name: str,
    clip_duration_seconds: float,
    clip_relative_path: str,
    subtitles: Sequence[Mapping[str, str | float]],
    fps: float,
) -> str:
    """Create a minimal Premiere-compatible XMEML project file."""

    duration_frames = max(1, int(round(clip_duration_seconds * fps)))

    root = ET.Element("xmeml", version="5")
    sequence = ET.SubElement(root, "sequence", id="sequence-1")
    ET.SubElement(sequence, "name").text = clip_name
    _build_rate_element(sequence, fps)
    ET.SubElement(sequence, "duration").text = str(duration_frames)

    media = ET.SubElement(sequence, "media")
    video = ET.SubElement(media, "video")

    format_el = ET.SubElement(video, "format")
    sample_char = ET.SubElement(format_el, "samplecharacteristics")
    rate_node = ET.SubElement(sample_char, "rate")
    timebase_value = str(int(round(fps if fps > 0 else 24)))
    ET.SubElement(rate_node, "timebase").text = timebase_value
    ET.SubElement(rate_node, "ntsc").text = _fps_to_timebase(fps)[1]
    ET.SubElement(sample_char, "width").text = "1080"
    ET.SubElement(sample_char, "height").text = "1920"
    ET.SubElement(sample_char, "pixelaspectratio").text = "square"

    track = ET.SubElement(video, "track")
    clip_id = "clipitem-1"
    clip_item = ET.SubElement(track, "clipitem", id=clip_id)
    ET.SubElement(clip_item, "name").text = clip_name
    _build_rate_element(clip_item, fps)
    ET.SubElement(clip_item, "start").text = "0"
    ET.SubElement(clip_item, "end").text = str(duration_frames)
    ET.SubElement(clip_item, "in").text = "0"
    ET.SubElement(clip_item, "out").text = str(duration_frames)
    ET.SubElement(clip_item, "duration").text = str(duration_frames)
    _append_log_info(clip_item)

    file_el = ET.SubElement(clip_item, "file", id="file-1")
    _build_rate_element(file_el, fps)
    ET.SubElement(file_el, "duration").text = str(duration_frames)
    ET.SubElement(file_el, "name").text = Path(clip_relative_path).name
    pathurl = ET.SubElement(file_el, "pathurl")
    pathurl.text = Path(clip_relative_path).as_posix()

    sourcetrack = ET.SubElement(clip_item, "sourcetrack")
    ET.SubElement(sourcetrack, "mediatype").text = "video"
    ET.SubElement(sourcetrack, "trackindex").text = "1"

    if subtitles:
        audio = ET.SubElement(media, "audio")
        track_audio = ET.SubElement(audio, "track")
        for idx, cue in enumerate(subtitles, start=1):
            marker = ET.SubElement(track_audio, "clipitem", id=f"marker-{idx}")
            ET.SubElement(marker, "name").text = str(cue.get("text", ""))
            _build_rate_element(marker, fps)
            start_frame = int(round(float(cue.get("start", 0)) * fps))
            end_frame = int(round(float(cue.get("end", start_frame)) * fps))
            ET.SubElement(marker, "start").text = str(start_frame)
            ET.SubElement(marker, "end").text = str(end_frame)
            _append_log_info(marker)

    return ET.tostring(root, encoding="utf-8").decode("utf-8")


def save_text_file(path: Path, payload: str) -> None:
    """Write ``payload`` to ``path`` using UTF-8 encoding."""

    path.write_text(payload, encoding="utf-8")


def _attr_or_key(entry, key: str, default: float | str = 0.0) -> float | str:
    if isinstance(entry, Mapping):
        return entry.get(key, default)
    return getattr(entry, key, default)


def build_srt_entries(subtitle_cues: Iterable[Mapping[str, str | float]]) -> list[dict[str, str | float]]:
    """Return subtitle cues as serialisable dictionaries."""

    serialised: list[dict[str, str | float]] = []
    for entry in subtitle_cues:
        text_value = _attr_or_key(entry, "text", "")
        start_value = _attr_or_key(entry, "start", 0.0)
        end_value = _attr_or_key(entry, "end", 0.0)
        serialised.append(
            {
                "text": str(text_value),
                "start": float(start_value),
                "end": float(end_value),
            }
        )
    return serialised

