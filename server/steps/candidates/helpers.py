from __future__ import annotations

from typing import List, Optional, Tuple
import json
import re
from pathlib import Path
from math import inf

from interfaces.clip_candidate import ClipCandidate
import config as cfg
from config import (
    DEBUG_ENFORCE,
    MAX_DURATION_SECONDS,
    MIN_DURATION_SECONDS,
    OVERLAP_MERGE_PERCENTAGE_REQUIREMENT,
    SWEET_SPOT_MAX_SECONDS,
    SWEET_SPOT_MIN_SECONDS,
)
from ...custom_types.tone import ToneStrategy

def _elog(msg: str) -> None:
    if DEBUG_ENFORCE:
        print(msg)


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
            "rating": round(c.rating, 1),
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
        if rating is not None:
            rating = round(rating, 1)
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


def _extend_to_quote_end(
    end: float, quote: str, items: List[Tuple[float, float, str]], *, gap: float = 0.6
) -> float:
    """Extend ``end`` forward through contiguous repeats of ``quote``.

    Starting from the transcript item containing ``end``, any immediately
    following items whose text exactly matches ``quote`` are consumed so long as
    the gap between segments does not exceed ``gap`` seconds.  The returned
    value is the end timestamp of the last matching segment.
    """
    if not quote:
        return end
    for idx, (s, e, txt) in enumerate(items):
        if s <= end <= e:
            last_end = e
            for nxt_s, nxt_e, nxt_txt in items[idx + 1 :]:
                if nxt_txt != quote or nxt_s - last_end > gap:
                    break
                last_end = nxt_e
            return max(end, last_end)
    return end


def refine_clip_window(
    start: float,
    end: float,
    items: List[Tuple[float, float, str]],
    *,
    strategy: ToneStrategy,
    words: Optional[List[dict]] = None,
    silences: Optional[List[Tuple[float, float]]] = None,
    dialog_ranges: Optional[List[Tuple[float, float]]] = None,
    pre_leadin: float = 0.25,
    post_tail: float = 0.45,
    max_extension: float = MAX_DURATION_SECONDS,
    quote: Optional[str] = None,
) -> Tuple[float, float]:
    """Refine a clip by snapping to natural boundaries (cascading, max-safe).

    Cascade order (guarded by config flags): Dialog -> Sentence -> Silence.
    A snap is applied only if it would NOT make the clip longer than the
    configured maximum duration. If a higher-priority snap would exceed the
    maximum, we try the next one in the cascade. If none are safe, we keep the
    current bounds. ``max_extension`` still caps how far the end may extend
    beyond the original end.

    ``quote`` extension is attempted first but only applied if it keeps the
    duration within the maximum.
    """
    # Start with original bounds
    s = start
    e = end

    # 1) Optional quote extension (end-only), capped by max duration and max_extension
    if quote:
        e_quote = _extend_to_quote_end(e, quote, items)
        # Respect max_extension from original end
        if e_quote - end > max_extension:
            e_quote = end + max_extension
        if (e_quote - s) <= MAX_DURATION_SECONDS:
            e = e_quote

    # Helper to test a proposed snap is within max duration
    def _apply_if_safe(new_s: float, new_e: float) -> Tuple[float, float]:
        if new_e < new_s:
            return s, e
        if (new_e - new_s) <= MAX_DURATION_SECONDS:
            return new_s, new_e
        return s, e

    # 2) Cascading snaps guarded by strategy flags
    # Dialog snap (highest priority)
    if strategy.snap_to_dialog and dialog_ranges:
        ds = snap_start_to_dialog_start(s, dialog_ranges)
        de = snap_end_to_dialog_end(e, dialog_ranges)
        s, e = _apply_if_safe(ds, de)

    # Sentence snap (next)
    if strategy.snap_to_sentence:
        # Use segment-level sentence start/end with max_extension protection on end
        ss = _snap_start_to_segment_start(s, items)
        se = _snap_end_to_segment_end(e, items, max_extension=max_extension)
        s, e = _apply_if_safe(ss, se)

    # Word boundaries (fine grained): keep within max duration
    if words:
        ws, we = snap_to_word_boundaries(s, e, words)
        s, e = _apply_if_safe(ws, we)

    # Silence snap (last)
    if strategy.snap_to_silence and silences:
        zs, ze = snap_to_silence(s, e, silences, pre_leadin=pre_leadin, post_tail=post_tail)
        s, e = _apply_if_safe(zs, ze)

    # Enforce a tiny minimum to avoid zero/negative clips
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
    *,
    max_duration_seconds: float = MAX_DURATION_SECONDS,
    merge_overlaps: bool = False,
    overlap_fraction_threshold: float = OVERLAP_MERGE_PERCENTAGE_REQUIREMENT,  # require ≥50% overlap of the shorter clip
) -> List[ClipCandidate]:
    """Optionally merge overlapping candidates without snapping.

    Policy:
    - Only merge if clips **overlap** by at least `overlap_fraction_threshold` of the **shorter** clip.
    - Never merge purely gapped clips (the old `merge_gap_seconds` is deprecated and ignored).
    - Only merge if the merged span stays within `max_duration_seconds`.
    - Never drop a candidate because a potential merge would exceed `max_duration_seconds`; skip the merge and keep both.
    """
    if not candidates:
        return []

    candidates = sorted(candidates, key=lambda c: (c.start, c.end))
    if not merge_overlaps:
        return candidates

    merged: List[ClipCandidate] = []
    cur = candidates[0]

    for nxt in candidates[1:]:
        # Compute temporal intersection
        inter_start = max(cur.start, nxt.start)
        inter_end = min(cur.end, nxt.end)
        inter = max(0.0, inter_end - inter_start)

        # Lengths of each
        len_cur = max(0.0, cur.end - cur.start)
        len_nxt = max(0.0, nxt.end - nxt.start)
        shorter = min(len_cur, len_nxt) if min(len_cur, len_nxt) > 0 else 0.0

        # Require a non-insignificant overlap: fraction of the shorter clip covered by the intersection
        overlap_fraction = (inter / shorter) if shorter > 0 else 0.0

        if overlap_fraction >= overlap_fraction_threshold:
            new_start = min(cur.start, nxt.start)
            new_end = max(cur.end, nxt.end)
            merged_len = new_end - new_start
            if merged_len <= max_duration_seconds:
                new_count = cur.count + nxt.count
                avg_rating = round(
                    (cur.rating * cur.count + nxt.rating * nxt.count) / new_count, 1
                )
                cur = ClipCandidate(
                    start=new_start,
                    end=new_end,
                    rating=avg_rating,
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
                    count=new_count,
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
    strategy: ToneStrategy,
    max_duration_seconds: float = MAX_DURATION_SECONDS,
    min_duration_seconds: float = MIN_DURATION_SECONDS,
    min_gap: float = 0.10,
    min_rating: float = 0.0,
    words: Optional[List[dict]] = None,
    silences: Optional[List[Tuple[float, float]]] = None,
    dialog_ranges: Optional[List[Tuple[float, float]]] = None,
) -> List[ClipCandidate]:
    """Adjust candidate boundaries, enforce non-overlap, and filter by rating.

    Clips around 10–30 seconds are preferred; candidates shorter than
    ``min_duration_seconds`` or with ``rating`` less than or equal to
    ``min_rating`` are discarded.
    """
    if not candidates:
        return []
    if not cfg.ENFORCE_NON_OVERLAP:
        return [
            c
            for c in candidates
            if (c.end - c.start) >= min_duration_seconds and c.rating >= min_rating
        ]

    adjusted: List[ClipCandidate] = []
    for c in candidates:
        if c.rating < min_rating:
            _elog(f"enforce: drop   | reason=low_rating {c.rating:.1f} < {min_rating:.1f}")
            continue
        orig_len = max(0.0, c.end - c.start)
        headroom = max(0.0, max_duration_seconds - orig_len)
        s, e = refine_clip_window(
            c.start,
            c.end,
            items,
            strategy=strategy,
            words=words,
            silences=silences,
            dialog_ranges=dialog_ranges,
            max_extension=headroom,
            quote=c.quote,
        )
        _elog(
            f"enforce: refine  | orig={c.start:.3f}-{c.end:.3f} dur={c.end-c.start:.3f} -> snapped={s:.3f}-{e:.3f} d={e-s:.3f} rating={c.rating:.1f}"
        )
        if e <= s:
            _elog("enforce: drop   | reason=end<=start")
            continue
        d = e - s
        # Allow minor FP tolerance when very close to the limit
        if d > max_duration_seconds and d <= max_duration_seconds + 1e-6:
            d = max_duration_seconds
            e = s + d
        if d > max_duration_seconds:
            _elog(f"enforce: drop   | reason=too_long d={d:.3f} > max={max_duration_seconds:.3f}")
            continue
        if d < min_duration_seconds:
            _elog(f"enforce: drop   | reason=too_short d={d:.3f} < min={min_duration_seconds:.3f}")
            continue
        new_c = ClipCandidate(
            start=s,
            end=e,
            rating=c.rating,
            reason=c.reason,
            quote=c.quote,
            count=c.count,
        )
        if hasattr(c, "tone_match"):
            new_c.tone_match = c.tone_match
        adjusted.append(new_c)
        _elog("enforce: keep    | stage=adjusted")

    if not adjusted:
        _elog("enforce: no adjusted candidates; returning []")
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

    _elog(f"enforce: adjusted_count={len(adjusted)}")
    adjusted.sort(key=score_key)
    selected: List[ClipCandidate] = []

    def overlaps(a: ClipCandidate, b: ClipCandidate) -> bool:
        return not (a.end + min_gap <= b.start or b.end + min_gap <= a.start)

    for cand in adjusted:
        suppressed = False
        for sel in selected:
            if overlaps(cand, sel):
                _elog(
                    f"enforce: suppress | cand={cand.start:.3f}-{cand.end:.3f} overlaps sel={sel.start:.3f}-{sel.end:.3f} (min_gap={min_gap:.2f})"
                )
                sel.rating = (
                    (sel.rating * sel.count) + cand.rating
                ) / (sel.count + 1)
                sel.count += 1
                suppressed = True
                break
        if not suppressed:
            selected.append(cand)
            _elog(
                f"enforce: select  | start={cand.start:.3f} end={cand.end:.3f} d={(cand.end-cand.start):.3f} rating={cand.rating:.1f}"
            )

    selected.sort(key=lambda x: x.start)
    return selected


def dedupe_candidates(
    candidates: List[ClipCandidate],
    *,
    time_tolerance: float = 0.05,
    iou_threshold: float = 0.6,
) -> List[ClipCandidate]:
    """Remove highly overlapping candidates, keeping the highest-rated.

    Candidates with Intersection-over-Union (IoU) greater than ``iou_threshold``
    are considered duplicates.  The higher-rated candidate is retained.
    ``time_tolerance`` is accepted for backward compatibility but no longer
    used for deduping.
    """
    if not candidates:
        return []

    sorted_cands = sorted(candidates, key=lambda c: c.rating, reverse=True)
    kept: List[ClipCandidate] = []
    for cand in sorted_cands:
        keep = True
        for other in kept:
            inter_start = max(cand.start, other.start)
            inter_end = min(cand.end, other.end)
            inter = max(0.0, inter_end - inter_start)
            if inter <= 0:
                continue
            union = (cand.end - cand.start) + (other.end - other.start) - inter
            if union <= 0:
                continue
            if inter / union > iou_threshold:
                keep = False
                break
        if keep:
            kept.append(cand)

    return sorted(kept, key=lambda c: (c.start, c.end))


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
    "_extend_to_quote_end",
    "_merge_adjacent_candidates",
    "_enforce_non_overlap",
    "dedupe_candidates",
]
