"""Transcript helpers."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Dict, Iterable, List


_QUOTE_MAP: Dict[str, str] = {
    "\u2018": "'",  # left single quotation mark
    "\u2019": "'",  # right single quotation mark
    "\u201c": '"',  # left double quotation mark
    "\u201d": '"',  # right double quotation mark
}


def normalize_quotes(text: str) -> str:
    """Replace common Unicode quotation marks with ASCII equivalents."""
    return text.translate(str.maketrans(_QUOTE_MAP))


def _normalize_words(words: Iterable[dict]) -> List[dict]:
    """Normalize raw whisper word entries."""

    normalized: List[dict] = []
    for word in words:
        try:
            start = float(word.get("start"))
            end = float(word.get("end"))
        except (TypeError, ValueError):
            continue
        text = normalize_quotes(str(word.get("text") or word.get("word") or "").strip())
        if not text or end <= start:
            continue
        normalized.append({"start": start, "end": end, "text": text})
    return normalized


def write_transcript_txt(result: dict, out_path: str) -> None:
    """Write segments and timing from transcribe_audio result to a .txt and JSON file."""

    segments = result.get("segments", [])
    timing = result.get("timing", {})
    path = Path(out_path)
    with path.open("w", encoding="utf-8") as f:
        serializable_segments: List[dict] = []
        for seg in segments:
            start = float(seg.get("start", 0.0))
            end = float(seg.get("end", 0.0))
            text = normalize_quotes((seg.get("text", "") or "").replace("\n", " ").strip())
            f.write(f"[{start:.2f} -> {end:.2f}] {text}\n")
            words = _normalize_words(seg.get("words", []) or [])
            serializable_segments.append(
                {
                    "start": start,
                    "end": end,
                    "text": text,
                    "words": words,
                }
            )
        f.write("\n# TIMING\n")
        f.write(f"start_time: {timing.get('start_time', 0.0):.2f} seconds\n")
        f.write(f"stop_time: {timing.get('stop_time', 0.0):.2f} seconds\n")
        f.write(f"total_time: {timing.get('total_time', 0.0):.2f} seconds\n")

    json_path = path.with_suffix(".json")
    payload = {"segments": serializable_segments, "timing": timing}
    json_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
