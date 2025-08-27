from __future__ import annotations

from typing import List, Optional, Tuple
from math import inf

from server.interfaces.clip_candidate import ClipCandidate
from .silence import snap_to_silence, snap_to_word_boundaries

__all__ = [
    "duration_score",
    "refine_clip_window",
    "_snap_start_to_segment_start",
    "_snap_end_to_segment_end",
    "_snap_start_to_sentence_start",
    "_snap_end_to_sentence_end",
    "_merge_adjacent_candidates",
    "_enforce_non_overlap",
]


def duration_score(d: float, sweet_min: float = 8.0, sweet_max: float = 30.0) -> float:
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
) -> Tuple[float, float]:
    """Snap to segment, then word (if available), then silence edges with small air."""
    s = _snap_start_to_segment_start(start, items)
    e = _snap_end_to_segment_end(end, items)
    if words:
        s, e = snap_to_word_boundaries(s, e, words)
    if silences:
        s, e = snap_to_silence(s, e, silences, pre_leadin=pre_leadin, post_tail=post_tail)
    if e - s < 0.30:
        e = s + 0.30
    return s, e


def _snap_end_to_segment_end(end_time: float, items: List[Tuple[float, float, str]]) -> float:
    """If ``end_time`` falls inside a transcript segment, extend to the end or continuation."""
    for idx, (s, e, _) in enumerate(items):
        if s <= end_time <= e:
            end = e
            for nxt_s, nxt_e, nxt_txt in items[idx + 1 :]:
                gap = nxt_s - end
                if gap > 0.6:
                    break
                first = nxt_txt.lstrip()[:1]
                if first and first.islower():
                    end = nxt_e
                    continue
                break
            return end
    return end_time


def _snap_start_to_segment_start(start_time: float, items: List[Tuple[float, float, str]]) -> float:
    """If ``start_time`` lands inside a spoken segment, snap to that segment's start."""
    for s, e, _ in items:
        if s <= start_time <= e:
            return s
    return start_time


def _snap_end_to_sentence_end(time: float, segments: List[Tuple[float, float, str]]) -> float:
    """Snap ``time`` to the end of the sentence/beat containing it."""
    for s, e, _ in segments:
        if s <= time <= e:
            return e
    return time


def _snap_start_to_sentence_start(time: float, segments: List[Tuple[float, float, str]]) -> float:
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
    max_duration_seconds: float = 60.0,
    words: Optional[List[dict]] = None,
    silences: Optional[List[Tuple[float, float]]] = None,
) -> List[ClipCandidate]:
    """Merge candidates that overlap or are separated by a tiny gap."""
    if not candidates:
        return []

    snapped: List[ClipCandidate] = []
    for c in candidates:
        s, e = refine_clip_window(c.start, c.end, items, words=words, silences=silences)
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
                        cur.reason + (" | " if cur.reason and nxt.reason else "") + nxt.reason
                    ).strip(),
                    quote=(
                        cur.quote + (" | " if cur.quote and nxt.quote else "") + nxt.quote
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
    max_duration_seconds: float = 60.0,
    min_gap: float = 0.10,
    words: Optional[List[dict]] = None,
    silences: Optional[List[Tuple[float, float]]] = None,
) -> List[ClipCandidate]:
    """Adjust candidate ends to segment boundaries and remove overlaps."""
    if not candidates:
        return []

    adjusted: List[ClipCandidate] = []
    for c in candidates:
        s, e = refine_clip_window(c.start, c.end, items, words=words, silences=silences)
        if e <= s:
            continue
        if (e - s) > max_duration_seconds:
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
        prior = 0.65 + 0.35 * duration_score(d, 8.0, 30.0)
        z = (x.rating - mean) / std
        tone_ok = bool(getattr(x, "tone_match", True))
        tone_penalty = 0 if tone_ok else 1
        length_bonus = 0.1 / max(d, 1.0)
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
