from __future__ import annotations
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
from typing import List, Optional, Tuple
import json
import re
from pathlib import Path

from helpers.ai import ollama_call_json, retry
from types.clip_candidate import ClipCandidate

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
        result.append(ClipCandidate(start=start, end=end, rating=rating, reason=reason, quote=quote))
    return result

# -----------------------------
# Transcript utilities
# -----------------------------

_TIME_RANGE = re.compile(r"^\[(?P<start>\d+(?:\.\d+)?)\s*->\s*(?P<end>\d+(?:\.\d+)?)\]\s*(?P<text>.*)$")


def parse_transcript(transcript_path: str | Path) -> List[Tuple[float, float, str]]:
    """Read a transcript .txt with lines like: `[12.34 -> 17.89] text`.
    Returns list of (start, end, text).
    """
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
# Clip sanity utilities (snap ends to segment boundaries, prevent overlap)
# -----------------------------

def _build_segment_index(items: List[Tuple[float, float, str]]):
    """Return parallel lists of segment starts and ends for binary search."""
    starts = [s for s, _, _ in items]
    ends = [e for _, e, _ in items]
    return starts, ends



def _snap_end_to_segment_end(end_time: float, items: List[Tuple[float, float, str]]) -> float:
    """If end_time lands inside a spoken segment, snap to that segment's end so we don't cut into the next line.
    If it lands in silence between segments, return unchanged.
    """
    # Linear scan is fine for typical transcript sizes; optimize later if needed
    for s, e, _ in items:
        if s <= end_time <= e:
            return e
    return end_time


# SNAP START TO SEGMENT START
def _snap_start_to_segment_start(start_time: float, items: List[Tuple[float, float, str]]) -> float:
    """If start_time lands inside a spoken segment, snap to that segment's start so we don't cut mid-line.
    If it lands in silence between segments, return unchanged.
    """
    for s, e, _ in items:
        if s <= start_time <= e:
            return s
    return start_time



# MERGE ADJACENT/OVERLAPPING CANDIDATES
def _merge_adjacent_candidates(
    candidates: List[ClipCandidate],
    items: List[Tuple[float, float, str]],
    *,
    merge_gap_seconds: float = 1.5,
    max_duration_seconds: float = 120.0,
) -> List[ClipCandidate]:
    """Merge candidates that overlap or are separated by a tiny gap, to preserve full jokes/bits.
    - Snap starts/ends to segment boundaries before merging.
    - If merged duration would exceed max_duration_seconds, keep as-is (no merge for that pair).
    """
    if not candidates:
        return []

    # Snap both ends first
    snapped: List[ClipCandidate] = []
    for c in candidates:
        s = _snap_start_to_segment_start(c.start, items)
        e = _snap_end_to_segment_end(c.end, items)
        if e <= s:
            continue
        snapped.append(ClipCandidate(start=s, end=e, rating=c.rating, reason=c.reason, quote=c.quote))

    if not snapped:
        return []

    # Sort by start time
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
                # Merge: keep the higher rating, concatenate reasons/quotes
                cur = ClipCandidate(
                    start=new_start,
                    end=new_end,
                    rating=max(cur.rating, nxt.rating),
                    reason=(cur.reason + (" | " if cur.reason and nxt.reason else "") + nxt.reason).strip(),
                    quote=(cur.quote + (" | " if cur.quote and nxt.quote else "") + nxt.quote).strip(),
                )
                continue
        # Cannot merge, push current and advance
        merged.append(cur)
        cur = nxt

    merged.append(cur)
    return merged


def _enforce_non_overlap(candidates: List[ClipCandidate], items: List[Tuple[float, float, str]], min_gap: float = 0.10) -> List[ClipCandidate]:
    """Adjusts candidate ends to segment boundaries and removes overlaps.
    Preference is given to higher-rated candidates when overlaps occur.
    Returns a list sorted by start time.
    Assumes starts are already snapped, but will snap both ends for safety.
    """
    if not candidates:
        return []

    # 1) Snap both starts and ends so we don't cut into new speech or mid-line
    adjusted: List[ClipCandidate] = []
    for c in candidates:
        snapped_start = _snap_start_to_segment_start(c.start, items)
        snapped_end = _snap_end_to_segment_end(c.end, items)
        if snapped_end <= snapped_start:
            continue
        adjusted.append(ClipCandidate(start=snapped_start, end=snapped_end, rating=c.rating, reason=c.reason, quote=c.quote))

    if not adjusted:
        return []

    # 2) Select non-overlapping by rating desc, then earlier start
    adjusted.sort(key=lambda x: (-x.rating, x.start, x.end))
    selected: List[ClipCandidate] = []

    def overlaps(a: ClipCandidate, b: ClipCandidate) -> bool:
        return not (a.end + min_gap <= b.start or b.end + min_gap <= a.start)

    for cand in adjusted:
        if any(overlaps(cand, s) for s in selected):
            continue
        selected.append(cand)

    # 3) Sort chronologically for output
    selected.sort(key=lambda x: x.start)
    return selected

def _chunk_transcript_items(items: List[Tuple[float, float, str]], *, max_chars: int = 12000, overlap_lines: int = 4) -> List[List[Tuple[float, float, str]]]:
    """Chunk transcript into pieces under a character budget with a small line overlap to avoid split jokes."""
    chunks: List[List[Tuple[float, float, str]]] = []
    buf: List[Tuple[float, float, str]] = []
    count = 0
    for triplet in items:
        s, e, t = triplet
        line_len = len(t) + 20  # include time-coding overhead
        if buf and (count + line_len) > max_chars:
            # push chunk with optional overlap
            chunks.append(buf[:])
            # seed with overlap tail
            tail = buf[-overlap_lines:] if overlap_lines > 0 else []
            buf = tail[:]
            count = sum(len(x[2]) + 20 for x in buf)
        buf.append(triplet)
        count += line_len
    if buf:
        chunks.append(buf)
    return chunks


def _format_items_for_prompt(items: List[Tuple[float, float, str]]) -> str:
    return "\n".join(f"[{s:.2f}-{e:.2f}] {t}" for s, e, t in items)


def find_funny_timestamps_batched(
    transcript_path: str | Path,
    *,
    min_rating: float = 7.0,
    model: str = "gemma3",
    options: Optional[dict] = None,
    max_chars_per_chunk: int = 12000,
    overlap_lines: int = 4,
    request_timeout: int = 180,
    exclude_ranges: Optional[List[Tuple[float, float]]] = None,
) -> List[ClipCandidate]:
    """Chunk the transcript and query the model per-chunk to avoid context/HTTP timeouts.

    - `exclude_ranges`: optional list of (start, end) ranges already chosen; we will ignore overlapping results.
    - Returns a non-overlapping, end-snapped set of ClipCandidates across the whole file.
    """
    items = parse_transcript(transcript_path)
    if not items:
        return []

    chunks = _chunk_transcript_items(items, max_chars=max_chars_per_chunk, overlap_lines=overlap_lines)
    print(f"[Batch] Processing {len(chunks)} transcript chunks...")

    system_instructions = (
        "You are ranking humorous or high-likelihood viral clip moments."
        " Consider punchlines, callbacks, playful insults, crowd laughter cues, exaggerated reactions, or topic pivots."
        " Return a JSON array ONLY."
        " Each item MUST be: {\"start\": number, \"end\": number, \"rating\": 1-10 number, \"reason\": string, \"quote\": string}."
        f" Include ONLY items with rating >= {min_rating}."
        " Use the provided time ranges; do not invent timestamps outside them."
        " Prefer segment boundaries but you may merge adjacent lines if a joke spans them."
    )

    all_candidates: List[ClipCandidate] = []
    min_ts = items[0][0]
    max_ts = max(e for _, e, _ in items)

    # Gentle model options for longer prompts
    combined_options = {"temperature": 0.2, "num_ctx": 8192}
    if options:
        combined_options.update(options)

    for idx, chunk in enumerate(chunks):
        print(f"[Batch] Processing chunk {idx+1}/{len(chunks)} with {len(chunk)} lines...")
        condensed = _format_items_for_prompt(chunk)
        prompt = (
            f"{system_instructions}\n\nTRANSCRIPT (time-coded):\n{condensed}\n\nReturn JSON now."
        )
        def _call():
            return ollama_call_json(
                model=model,
                prompt=prompt,
                options=combined_options,
                timeout=request_timeout,
            )
        try:
            arr = retry(_call)
        except Exception as e:
            # Skip this chunk on repeated failure
            print(f"Ollama chunk failed, skipping: {e}")
            continue
        print(f"[Batch] Chunk {idx+1}: Model returned {len(arr)} raw candidates.")
        for it in arr:
            start = _to_float(_get_field(it, "start"))
            end = _to_float(_get_field(it, "end"))
            rating = _to_float(_get_field(it, "rating"))
            reason = str(_get_field(it, "reason", "")).strip()
            quote = str(_get_field(it, "quote", "")).strip()
            if start is None or end is None or rating is None:
                # Skip malformed candidate
                continue
            if not (min_ts <= start < end <= max_ts):
                continue
            if rating < min_rating:
                continue
            all_candidates.append(ClipCandidate(start=start, end=end, rating=rating, reason=reason, quote=quote))

    # Optionally filter out overlaps with previously selected clips
    if exclude_ranges:
        def overlaps_any(c: ClipCandidate) -> bool:
            for a, b in exclude_ranges:
                if not (c.end <= a or c.start >= b):
                    return True
            return False
        all_candidates = [c for c in all_candidates if not overlaps_any(c)]

    print(f"[Batch] Collected {len(all_candidates)} raw candidates across all chunks. Merging and enforcing non-overlap...")
    # Merge adjacent/overlapping candidates into full bits before non-overlap selection
    all_candidates = _merge_adjacent_candidates(all_candidates, items, merge_gap_seconds=1.5, max_duration_seconds=120.0)
    # Enforce snapping and non-overlap globally
    result = _enforce_non_overlap(all_candidates, items)
    print(f"[Batch] {len(result)} candidates remain after overlap enforcement.")
    return result

# -----------------------------
# LLM (Ollama / gemma3) utilities
# -----------------------------

def find_funny_timestamps(
    transcript_path: str | Path,
    min_rating: float = 7.0,
    model: str = "gemma3",
    options: Optional[dict] = None,
) -> List[ClipCandidate]:
    """Use a local Ollama model (gemma3) to score transcript lines and propose clip windows.

    Strategy: send a condensed transcript where each line embeds its time range.
    The model returns JSON with objects: {start, end, rating, reason, quote}.
    We keep all with rating >= min_rating.
    """
    items = parse_transcript(transcript_path)
    if not items:
        return []

    # Boundaries for safety clipping
    min_ts = items[0][0]
    max_ts = max(e for _, e, _ in items)

    # Build condensed transcript string
    condensed_lines = [f"[{s:.2f}-{e:.2f}] {t}" for s, e, t in items]
    MAX_SINGLE_CHARS = 12000
    condensed = []
    total = 0
    for line in condensed_lines:
        ln = len(line) + 1
        if total + ln > MAX_SINGLE_CHARS:
            break
        condensed.append(line)
        total += ln
    condensed = "\n".join(condensed)

    system_instructions = (
        "You are ranking humorous or high-likelihood viral clip moments."
        " Consider punchlines, callbacks, playful insults, crowd laughter cues,"
        " exaggerated reactions, or obvious topic pivots."
        " Return a JSON array ONLY."
        " Each item MUST be: {\"start\": number, \"end\": number, \"rating\": 1-10 number, \"reason\": string, \"quote\": string}."
        f" Include ONLY items with rating >= {min_rating}."
        " Use the provided time ranges; do not invent timestamps outside them."
        " Prefer segment boundaries but you may merge adjacent lines if a joke spans them."
    )

    prompt = (
        f"{system_instructions}\n\n"
        f"TRANSCRIPT (time-coded):\n{condensed}\n\n"
        "Return JSON now."
    )

    print("[Single] Sending transcript to model for funny timestamp extraction...")
    parsed = ollama_call_json(model=model, prompt=prompt, options=options)
    print(f"[Single] Model returned {len(parsed)} raw candidates before filtering.")
    candidates: List[ClipCandidate] = []
    for it in parsed:
        start = _to_float(_get_field(it, "start"))
        end = _to_float(_get_field(it, "end"))
        rating = _to_float(_get_field(it, "rating"))
        reason = str(_get_field(it, "reason", "")).strip()
        quote = str(_get_field(it, "quote", "")).strip()
        if start is None or end is None or rating is None:
            # Skip malformed candidate
            continue
        # Clamp and validate
        if not (min_ts <= start < end <= max_ts):
            continue
        if rating < min_rating:
            continue
        candidates.append(ClipCandidate(start=start, end=end, rating=rating, reason=reason, quote=quote))

    # Merge adjacent/overlapping candidates into full bits before non-overlap selection
    candidates = _merge_adjacent_candidates(candidates, items, merge_gap_seconds=1.5, max_duration_seconds=120.0)
    # Snap to segment ends and prevent overlapping clips
    candidates = _enforce_non_overlap(candidates, items)
    return candidates

