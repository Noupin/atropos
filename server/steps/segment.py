from __future__ import annotations

import json
import re
from pathlib import Path
from typing import List, Tuple

_SENTENCE_SPLIT = re.compile(r"(?<=[.!?])\s+")


def segment_transcript_items(
    items: List[Tuple[float, float, str]]
) -> List[Tuple[float, float, str]]:
    """Split transcript items into sentence-level segments with proportional timestamps.

    Parameters
    ----------
    items:
        List of ``(start, end, text)`` triples from :func:`parse_transcript`.
    Returns
    -------
    List[Tuple[float, float, str]]
        New list where each entry corresponds to a single sentence/beat.
    """
    segments: List[Tuple[float, float, str]] = []
    for start, end, text in items:
        sentences = [s.strip() for s in _SENTENCE_SPLIT.split(text) if s.strip()]
        if not sentences:
            continue
        total_len = sum(len(s) for s in sentences)
        cur = start
        duration = end - start
        for sent in sentences:
            ratio = len(sent) / total_len if total_len else 0.0
            seg_end = cur + duration * ratio
            segments.append((cur, seg_end, sent))
            cur = seg_end
    return segments


def write_segments_json(
    segments: List[Tuple[float, float, str]], output_path: str | Path
) -> None:
    """Write segments to ``output_path`` as JSON."""
    out = Path(output_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    payload = [
        {"start": s, "end": e, "text": t}
        for s, e, t in segments
    ]
    out.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
