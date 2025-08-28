from __future__ import annotations

from typing import List, Optional, Tuple
import json
import re
from pathlib import Path
from math import inf

from interfaces.clip_candidate import ClipCandidate
from .config import (
    MAX_DURATION_SECONDS,
    MIN_DURATION_SECONDS,
    SWEET_SPOT_MAX_SECONDS,
    SWEET_SPOT_MIN_SECONDS,
)


# -----------------------------
# Safe field helpers
# -----------------------------

def _get_field(obj, key, default=None):
    """Return obj[key] if dict-like, getattr(obj, key) if attribute-like, else default."""
    if isinstance(obj, dict):
        return obj.get(key, default)
    return getattr(obj, key, default)


def _to_float(val):
    try:
        return float(val)
    except Exception:
        return None


# -----------------------------
# Manifest utils (export/import candidates)
# -----------------------------

def export_candidates_json(candidates: List[ClipCandidate], path: str | Path) -> None:
    out = Path(path)
    out.parent.mkdir(parents=True, exist_ok=True)
    payload = [
        {
            "start": c.start,
            "end": c.end,
            "rating": c.rating,
            "reason": c.reason,
            "quote": c.quote,
        }
        for c in candidates
    ]
    out.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def load_candidates_json(path: str | Path) -> List[ClipCandidate]:
    p = Path(path)
    data = json.loads(p.read_text(encoding="utf-8"))
    result: List[ClipCandidate] = []
    for it in data:
        start = _to_float(_get_field(it, "start"))
        end = _to_float(_get_field(it, "end"))
        rating = _to_float(_get_field(it, "rating"))
        reason = str(_get_field(it, "reason", ""))
        quote = str(_get_field(it, "quote", ""))
        if start is None or end is None or rating is None:
            continue
        result.append(
            ClipCandidate(
                start=start, end=end, rating=rating, reason=reason, quote=quote
            )
        )
    return result


# -----------------------------
# Transcript utilities
# -----------------------------

_TIME_RANGE = re.compile(
    r"^\[(?P<start>\d+(?:\.\d+)?)\s*->\s*(?P<end>\d+(?:\.\d+)?)\]\s*(?P<text>.*)$"
)


def parse_transcript(transcript_path: str | Path) -> List[Tuple[float, float, str]]:
    """Read a transcript .txt with lines like: `[12.34 -> 17.89] text`.
    Returns list of (start, end, text)."""
    items: List[Tuple[float, float, str]] = []
    p = Path(transcript_path)
    if not p.exists():
        raise FileNotFoundError(f"Transcript not found: {transcript_path}")
    with p.open("r", encoding="utf-8") as f:
        for line in f:
            m = _TIME_RANGE.match(line.strip())
            if not m:
                continue
            start = float(m.group("start"))
            end = float(m.group("end"))
            text = m.group("text").strip()
            if text:
                items.append((start, end, text))
    return items


# -----------------------------
# Silence/VAD utilities (FFmpeg silencedetect logs)
# -----------------------------

def parse_ffmpeg_silences(log_text: str) -> List[Tuple[float, float]]:
    """Parse ffmpeg -af silencedetect logs into [(silence_start, silence_end), ...]."""
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
    """Snap [start,end] outward to nearest surrounding silence + small air before/after."""
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


# -----------------------------
# Word-boundary utility (optional if you have word timestamps)
# -----------------------------

def snap_to_word_boundaries(start: float, end: float, words: List[dict]) -> Tuple[float, float]:
    """Clamp to the first/last word overlapping [start,end]. words = [{start,end,text}, ...]."""
    if not words:
        return start, end
    # first word whose end >= start
    s_idx = next((i for i, w in enumerate(words) if float(w.get("end", 0)) >= start), None)
    # last word whose start <= end
    e_idx = next((i for i in range(len(words) - 1, -1, -1) if float(words[i].get("start", inf)) <= end), None)
    if s_idx is None or e_idx is None or e_idx < s_idx:
        return start, end
    s = float(words[s_idx].get("start", start))
    e = float(words[e_idx].get("end", end))
    if e <= s:
        e = s + 0.10
    return s, e


# -----------------------------
# Dialog range utilities
# -----------------------------

def snap_start_to_dialog_start(
    start: float, ranges: List[Tuple[float, float]]
) -> float:
    """Snap ``start`` to the beginning of the dialog range containing it."""
    for s, e in ranges:
        if s <= start <= e:
            return s
    return start


def snap_end_to_dialog_end(end: float, ranges: List[Tuple[float, float]]) -> float:
    """Snap ``end`` to the conclusion of the dialog range containing it."""
    for s, e in ranges:
        if s <= end <= e:
            return e
    return end


# -----------------------------
# Unified clip refinement + duration prior
# -----------------------------

def duration_score(
    d: float,
    sweet_min: float = SWEET_SPOT_MIN_SECONDS,
    sweet_max: float = SWEET_SPOT_MAX_SECONDS,
) -> float:
    """Soft prior: 1.0 inside sweet spot; quadratic decay outside."""
    if d < sweet_min:
        return max(0.0, 1.0 - ((sweet_min - d) / sweet_min) ** 2)
    if d > sweet_max:
        return max(0.0, 1.0 - ((d - sweet_max) / sweet_max) ** 2)
    return 1.0


def refine_clip_window(
    start: float,
    end: float,
    items: List[Tuple[float, float, str]],
    *,
    words: Optional[List[dict]] = None,
    silences: Optional[List[Tuple[float, float]]] = None,
    pre_leadin: float = 0.25,
    post_tail: float = 0.45,
    max_extension: float = MAX_DURATION_SECONDS,
) -> Tuple[float, float]:
    """Refine a clip by snapping to natural boundaries.

    The ``end`` is extended to consume adjacent transcript segments when they
    appear to be a continuation of the same sentence.  ``max_extension`` limits
    how far beyond the original ``end`` the refinement may extend.
    """
    s = _snap_start_to_segment_start(start, items)
    e = _snap_end_to_segment_end(end, items, max_extension=max_extension)
    if words:
        s, e = snap_to_word_boundaries(s, e, words)
    if silences:
        s, e = snap_to_silence(s, e, silences, pre_leadin=pre_leadin, post_tail=post_tail)
    if e - s < 0.30:
        e = s + 0.30
    return s, e


# -----------------------------
# Clip sanity utilities (snap ends to segment boundaries, prevent overlap)
# -----------------------------

def _snap_end_to_segment_end(
    end_time: float,
    items: List[Tuple[float, float, str]],
    *,
    max_extension: float = MAX_DURATION_SECONDS,
) -> float:
    """Extend ``end_time`` to the conclusion of the current sentence.

    Adjacent transcript segments are consumed when they appear to be part of the
    same sentence (a short gap and the next segment starting with a lowercase
    character).  Iteration stops if adding the next segment would extend the
    clip beyond ``max_extension`` seconds from the original ``end_time``.
    """
    for idx, (s, e, _) in enumerate(items):
        if s <= end_time <= e:
            end = e
            if end - end_time >= max_extension:
                return end_time + max_extension
            for nxt_s, nxt_e, nxt_txt in items[idx + 1 :]:
                gap = nxt_s - end
                if gap > 0.6:
                    break
                if nxt_e - end_time > max_extension:
                    break
                first = nxt_txt.lstrip()[:1]
                if first and first.islower():
                    end = nxt_e
                    if end - end_time >= max_extension:
                        return end_time + max_extension
                    continue
                break
            return end
    return end_time


def _snap_start_to_segment_start(
    start_time: float, items: List[Tuple[float, float, str]]
) -> float:
    """If start_time lands inside a spoken segment, snap to that segment's start so we don't cut mid-line.
    If it lands in silence between segments, return unchanged."""
    for s, e, _ in items:
        if s <= start_time <= e:
            return s
    return start_time


def _snap_end_to_sentence_end(
    time: float, segments: List[Tuple[float, float, str]]
) -> float:
    """Snap ``time`` to the end of the sentence/beat containing it."""
    for s, e, _ in segments:
        if s <= time <= e:
            return e
    return time


def _snap_start_to_sentence_start(
    time: float, segments: List[Tuple[float, float, str]]
) -> float:
    """Snap ``time`` to the beginning of the sentence/beat containing it."""
    for s, e, _ in segments:
        if s <= time <= e:
            return s
    return time


def _merge_adjacent_candidates(
    candidates: List[ClipCandidate],
    items: List[Tuple[float, float, str]],
    *,
    merge_gap_seconds: float = 1.0,
    max_duration_seconds: float = MAX_DURATION_SECONDS,
    words: Optional[List[dict]] = None,
    silences: Optional[List[Tuple[float, float]]] = None,
    merge_overlaps: bool = False,
) -> List[ClipCandidate]:
    """Snap candidate boundaries and optionally merge adjacent/overlapping candidates."""
    if not candidates:
        return []

    snapped: List[ClipCandidate] = []
    for c in candidates:
        s, e = refine_clip_window(
            c.start,
            c.end,
            items,
            words=words,
            silences=silences,
            max_extension=max_duration_seconds,
        )
        if e <= s:
            continue
        if (e - s) > max_duration_seconds:
            continue
        snapped.append(
            ClipCandidate(start=s, end=e, rating=c.rating, reason=c.reason, quote=c.quote)
        )

    if not snapped:
        return []

    snapped.sort(key=lambda c: (c.start, c.end))
    if not merge_overlaps:
        return snapped

    merged: List[ClipCandidate] = []
    cur = snapped[0]

    for nxt in snapped[1:]:
        gap = nxt.start - cur.end
        overlap = gap <= 0
        tiny_gap = 0 <= gap <= merge_gap_seconds
        if overlap or tiny_gap:
            new_start = min(cur.start, nxt.start)
            new_end = max(cur.end, nxt.end)
            if (new_end - new_start) <= max_duration_seconds:
                cur = ClipCandidate(
                    start=new_start,
                    end=new_end,
                    rating=max(cur.rating, nxt.rating),
                    reason=(
                        cur.reason
                        + (" | " if cur.reason and nxt.reason else "")
                        + nxt.reason
                    ).strip(),
                    quote=(
                        cur.quote
                        + (" | " if cur.quote and nxt.quote else "")
                        + nxt.quote
                    ).strip(),
                )
                continue
        merged.append(cur)
        cur = nxt

    merged.append(cur)
    return merged


def _enforce_non_overlap(
    candidates: List[ClipCandidate],
    items: List[Tuple[float, float, str]],
    *,
    max_duration_seconds: float = MAX_DURATION_SECONDS,
    min_duration_seconds: float = MIN_DURATION_SECONDS,
    min_gap: float = 0.10,
    words: Optional[List[dict]] = None,
    silences: Optional[List[Tuple[float, float]]] = None,
) -> List[ClipCandidate]:
    """Adjusts candidate ends to segment boundaries and removes overlaps.

    Clips around 10–30 seconds are preferred; candidates shorter than
    ``min_duration_seconds`` are discarded.
    """
    if not candidates:
        return []

    adjusted: List[ClipCandidate] = []
    for c in candidates:
        s, e = refine_clip_window(
            c.start,
            c.end,
            items,
            words=words,
            silences=silences,
            max_extension=max_duration_seconds,
        )
        if e <= s:
            continue
        d = e - s
        if d > max_duration_seconds:
            continue
        if d < min_duration_seconds:
            continue
        new_c = ClipCandidate(start=s, end=e, rating=c.rating, reason=c.reason, quote=c.quote)
        if hasattr(c, "tone_match"):
            new_c.tone_match = c.tone_match
        adjusted.append(new_c)

    if not adjusted:
        return []
    ratings = [c.rating for c in adjusted]
    mean = sum(ratings) / len(ratings)
    var = sum((r - mean) ** 2 for r in ratings) / len(ratings)
    std = var ** 0.5 if var > 0 else 1.0

    def score_key(x: ClipCandidate):
        d = x.end - x.start
        # Favor clips in the 10–30s sweet spot using duration_score.
        prior = 0.65 + 0.35 * duration_score(d, 10.0, 30.0)
        z = (x.rating - mean) / std
        tone_ok = bool(getattr(x, "tone_match", True))
        tone_penalty = 0 if tone_ok else 1
        # Provide a small preference for longer clips but none for clips below
        # the minimum duration threshold.
        length_bonus = 0.0 if d < min_duration_seconds else 0.1 / d
        score = z * prior + length_bonus
        return (tone_penalty, -score, d, x.start, x.end)

    adjusted.sort(key=score_key)
    selected: List[ClipCandidate] = []

    def overlaps(a: ClipCandidate, b: ClipCandidate) -> bool:
        return not (a.end + min_gap <= b.start or b.end + min_gap <= a.start)

    for cand in adjusted:
        if any(overlaps(cand, s) for s in selected):
            continue
        selected.append(cand)

    selected.sort(key=lambda x: x.start)
    return selected


__all__ = [
    "_get_field",
    "_to_float",
    "export_candidates_json",
    "load_candidates_json",
    "parse_transcript",
    "parse_ffmpeg_silences",
    "snap_to_silence",
    "snap_start_to_dialog_start",
    "snap_end_to_dialog_end",
    "snap_to_word_boundaries",
    "duration_score",
    "refine_clip_window",
    "_snap_start_to_segment_start",
    "_snap_end_to_segment_end",
    "_merge_adjacent_candidates",
    "_enforce_non_overlap",
]
