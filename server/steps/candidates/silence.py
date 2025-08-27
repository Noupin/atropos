from __future__ import annotations

from typing import List, Tuple

__all__ = [
    "parse_ffmpeg_silences",
    "snap_to_silence",
    "snap_to_word_boundaries",
]


def parse_ffmpeg_silences(log_text: str) -> List[Tuple[float, float]]:
    """Parse ffmpeg -af silencedetect logs into ``[(silence_start, silence_end), ...]``."""
    silences: List[Tuple[float, float]] = []
    start = None
    for ln in log_text.splitlines():
        ln = ln.strip()
        if "silence_start:" in ln:
            try:
                start = float(ln.split("silence_start:")[1].strip())
            except Exception:
                start = None
        elif "silence_end:" in ln and start is not None:
            try:
                t = ln.split("silence_end:")[1].strip().split()[0]
                end = float(t)
                silences.append((start, end))
            except Exception:
                pass
            start = None
    return silences


def snap_to_silence(
    start: float,
    end: float,
    silences: List[Tuple[float, float]],
    *,
    pre_leadin: float = 0.25,
    post_tail: float = 0.45,
) -> Tuple[float, float]:
    """Snap ``[start,end]`` outward to nearest surrounding silence with air before/after."""
    if not silences:
        return start, end
    prev_sil_end = None
    next_sil_start = None
    for s0, e0 in silences:
        if e0 <= start:
            prev_sil_end = e0
        if s0 >= end and next_sil_start is None:
            next_sil_start = s0
    s = start if prev_sil_end is None else max(0.0, prev_sil_end + pre_leadin)
    e = end if next_sil_start is None else max(s + 0.10, next_sil_start - post_tail)
    return s, e


def snap_to_word_boundaries(start: float, end: float, words: List[dict]) -> Tuple[float, float]:
    """Clamp to the first/last word overlapping ``[start,end]``.``words=[{start,end,text},...]``"""
    if not words:
        return start, end
    # first word whose end >= start
    s_idx = next((i for i, w in enumerate(words) if float(w.get("end", 0)) >= start), None)
    # last word whose start <= end
    e_idx = next(
        (i for i in range(len(words) - 1, -1, -1) if float(words[i].get("start", float("inf"))) <= end),
        None,
    )
    if s_idx is None or e_idx is None or e_idx < s_idx:
        return start, end
    s = float(words[s_idx].get("start", start))
    e = float(words[e_idx].get("end", end))
    if e <= s:
        e = s + 0.10
    return s, e
