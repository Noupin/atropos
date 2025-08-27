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
from math import inf

from helpers.ai import ollama_call_json, retry
from interfaces.clip_candidate import ClipCandidate

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
# Unified clip refinement + duration prior
# -----------------------------

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
    # Your existing segment snaps
    s = _snap_start_to_segment_start(start, items)
    e = _snap_end_to_segment_end(end, items)
    # Word-level (optional)
    if words:
        s, e = snap_to_word_boundaries(s, e, words)
    # Silence edges (optional)
    if silences:
        s, e = snap_to_silence(s, e, silences, pre_leadin=pre_leadin, post_tail=post_tail)
    if e - s < 0.30:
        e = s + 0.30
    return s, e


# -----------------------------
# Clip sanity utilities (snap ends to segment boundaries, prevent overlap)
# -----------------------------


def _build_segment_index(items: List[Tuple[float, float, str]]):
    """Return parallel lists of segment starts and ends for binary search."""
    starts = [s for s, _, _ in items]
    ends = [e for _, e, _ in items]
    return starts, ends


def _snap_end_to_segment_end(
    end_time: float, items: List[Tuple[float, float, str]]
) -> float:
    """If ``end_time`` falls inside a transcript segment, extend the end to the
    conclusion of that spoken line.  Additional adjacent segments are also
    consumed when they appear to be a continuation of the same sentence—i.e.
    a short gap and the next segment begins with a lowercase character.

    This helps clips end on a natural pause or sentence boundary rather than
    cutting off mid-thought.
    """
    for idx, (s, e, _) in enumerate(items):
        if s <= end_time <= e:
            end = e
            # walk forward while segments appear to continue the sentence
            for nxt_s, nxt_e, nxt_txt in items[idx + 1 :]:
                gap = nxt_s - end
                if gap > 0.6:  # a noticeable pause marks a good stopping point
                    break
                first = nxt_txt.lstrip()[:1]
                if first and first.islower():
                    end = nxt_e
                    continue
                break
            return end
    return end_time


# SNAP START TO SEGMENT START
def _snap_start_to_segment_start(
    start_time: float, items: List[Tuple[float, float, str]]
) -> float:
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
    merge_gap_seconds: float = 1.0,
    max_duration_seconds: float = 60.0,
    words: Optional[List[dict]] = None,
    silences: Optional[List[Tuple[float, float]]] = None,
) -> List[ClipCandidate]:
    """Merge candidates that overlap or are separated by a tiny gap, to preserve full jokes/bits.
    - Snap starts/ends to segment boundaries before merging.
    - Candidates exceeding ``max_duration_seconds`` are discarded rather than trimmed.
    - If merged duration would exceed ``max_duration_seconds``, keep as-is (no merge for that pair).
    """
    if not candidates:
        return []

    # Snap both ends first (now refined with words/silence when available)
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
        # Cannot merge, push current and advance
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
    """Adjusts candidate ends to segment boundaries and removes overlaps.
    Preference is given to higher-rated candidates when overlaps occur.
    Returns a list sorted by start time.
    Assumes starts are already snapped, but will snap both ends for safety.
    Drops any candidate exceeding ``max_duration_seconds``.
    """
    if not candidates:
        return []

    # 1) Snap both starts and ends so we don't cut into new speech or mid-line
    adjusted: List[ClipCandidate] = []
    for c in candidates:
        s, e = refine_clip_window(c.start, c.end, items, words=words, silences=silences)
        if e <= s:
            continue
        if (e - s) > max_duration_seconds:
            continue
        adjusted.append(
            ClipCandidate(start=s, end=e, rating=c.rating, reason=c.reason, quote=c.quote)
        )

    if not adjusted:
        return []

    # Short-clip bias (8–30s sweet spot by default)
    def score_key(x: ClipCandidate):
        d = x.end - x.start
        prior = 0.65 + 0.35 * duration_score(d, 8.0, 30.0)
        return (-(x.rating * prior), x.start, x.end)

    adjusted.sort(key=score_key)
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


def _chunk_transcript_items(
    items: List[Tuple[float, float, str]],
    *,
    max_chars: int = 12000,
    overlap_lines: int = 4,
) -> List[List[Tuple[float, float, str]]]:
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


_FUNNY_PROMPT_DESC = (
    "genuinely funny, laugh-inducing moments. Focus on bits that have a clear setup and a punchline, "
    "or a sharp twist/surprise. Prioritize incongruity, exaggeration, taboo/embarrassment (PG–R), "
    "playful insults/roasts, callbacks, misdirection, and deadpan contradictions. Avoid bland banter, "
    "filler agreement, or mere information."
)

_INSPIRING_PROMPT_DESC = (
    "uplifting or motivational moments that stir positive emotion, showcase overcoming "
    "challenges, or deliver heartfelt advice."
)

_EDUCATIONAL_PROMPT_DESC = (
    "informative, insightful, or instructional moments that clearly teach a concept or "
    "share useful facts."
)


def _build_system_instructions(prompt_desc: str, min_rating: float) -> str:
    return (
        f"You are ranking moments that are most aligned with this target: {prompt_desc}\n"
        "Return a JSON array ONLY. Each item MUST be: "
        '{"start": number, "end": number, "rating": 1-10 number, '
        '"reason": string, "quote": string, "tags": string[]}\n'
        f"Include ONLY items with rating >= {min_rating}.\n"
        "RUBRIC (all must be true for inclusion):\n"
        "- Relevance: The moment strongly reflects the target described above.\n"
        "- Coherence: It forms a self-contained beat; the audience will understand without extra context.\n"
        "- Clipability: It is engaging and quotable; likely to grab attention in a short clip.\n"
        "- Completeness: Start at the natural setup/lead-in (not mid-word) and end right after the payoff/beat lands.\n"
        "NEGATIVE FILTERS (exclude these):\n"
        "- Filler, bland agreement, mere exposition, or housekeeping.\n"
        "- Partial thoughts that cut off before the key beat/payoff.\n"
        "SCORING GUIDE:\n"
        "9–10: extremely aligned, highly engaging, shareable.\n"
        "8: clearly strong, likely to resonate with most viewers.\n"
        "7: decent; include only if there are few stronger options in this span.\n"
        "TIMING RULES:\n"
        "- Prefer segment boundaries; may extend across adjacent lines to capture the full beat.\n"
        "- Do NOT invent timestamps outside provided ranges.\n"
    )


def find_clip_timestamps_batched(
    transcript_path: str | Path,
    *,
    prompt_desc: str = _FUNNY_PROMPT_DESC,
    min_rating: float = 7.0,
    model: str = "gemma3",
    options: Optional[dict] = None,
    max_chars_per_chunk: int = 12000,
    overlap_lines: int = 4,
    request_timeout: int = 180,
    exclude_ranges: Optional[List[Tuple[float, float]]] = None,
    silences: Optional[List[Tuple[float, float]]] = None,
    words: Optional[List[dict]] = None,
) -> List[ClipCandidate]:
    """Chunk the transcript and query the model per-chunk to avoid context/HTTP timeouts.

    - `exclude_ranges`: optional list of (start, end) ranges already chosen; we will ignore overlapping results.
    - Returns a non-overlapping, end-snapped set of ClipCandidates across the whole file.
    """
    items = parse_transcript(transcript_path)
    if not items:
        return []

    chunks = _chunk_transcript_items(
        items, max_chars=max_chars_per_chunk, overlap_lines=overlap_lines
    )
    print(f"[Batch] Processing {len(chunks)} transcript chunks...")

    system_instructions = _build_system_instructions(prompt_desc, min_rating)

    all_candidates: List[ClipCandidate] = []
    min_ts = items[0][0]
    max_ts = max(e for _, e, _ in items)

    # Gentle model options for longer prompts
    combined_options = {"temperature": 0.2, "num_ctx": 8192}
    if options:
        combined_options.update(options)

    for idx, chunk in enumerate(chunks):
        print(
            f"[Batch] Processing chunk {idx+1}/{len(chunks)} with {len(chunk)} lines..."
        )
        condensed = _format_items_for_prompt(chunk)
        prompt = f"{system_instructions}\n\nTRANSCRIPT (time-coded):\n{condensed}\n\nReturn JSON now."

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
            all_candidates.append(
                ClipCandidate(
                    start=start, end=end, rating=rating, reason=reason, quote=quote
                )
            )

    # Optionally filter out overlaps with previously selected clips
    if exclude_ranges:

        def overlaps_any(c: ClipCandidate) -> bool:
            for a, b in exclude_ranges:
                if not (c.end <= a or c.start >= b):
                    return True
            return False

        all_candidates = [c for c in all_candidates if not overlaps_any(c)]

    print(
        f"[Batch] Collected {len(all_candidates)} raw candidates across all chunks. Merging and enforcing non-overlap..."
    )
    # Merge adjacent/overlapping candidates into full bits before non-overlap selection
    all_candidates = _merge_adjacent_candidates(
        all_candidates, items, merge_gap_seconds=1.0, max_duration_seconds=60.0,
        words=words, silences=silences
    )
    # Enforce snapping and non-overlap globally
    result = _enforce_non_overlap(all_candidates, items, words=words, silences=silences)
    print(f"[Batch] {len(result)} candidates remain after overlap enforcement.")
    return result


# -----------------------------
# LLM (Ollama / gemma3) utilities
# -----------------------------


def find_clip_timestamps(
    transcript_path: str | Path,
    *,
    prompt_desc: str = _FUNNY_PROMPT_DESC,
    min_rating: float = 7.0,
    model: str = "gemma3",
    options: Optional[dict] = None,
    silences: Optional[List[Tuple[float, float]]] = None,
    words: Optional[List[dict]] = None,
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

    system_instructions = _build_system_instructions(prompt_desc, min_rating)

    prompt = (
        f"{system_instructions}\n\n"
        f"TRANSCRIPT (time-coded):\n{condensed}\n\n"
        "Return JSON now."
    )

    print("[Single] Sending transcript to model for timestamp extraction...")
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
        candidates.append(
            ClipCandidate(
                start=start, end=end, rating=rating, reason=reason, quote=quote
            )
        )

    # Merge adjacent/overlapping candidates into full bits before non-overlap selection
    candidates = _merge_adjacent_candidates(
        candidates, items, merge_gap_seconds=1.0, max_duration_seconds=60.0,
        words=words, silences=silences
    )
    # Snap to segment ends and prevent overlapping clips
    candidates = _enforce_non_overlap(candidates, items, words=words, silences=silences)
    return candidates


# Convenience wrappers --------------------------------------------------------


def find_funny_timestamps_batched(
    transcript_path: str | Path,
    *,
    min_rating: float = 8.0,
    **kwargs,
) -> List[ClipCandidate]:
    """Find humorous clip candidates using batched processing."""
    return find_clip_timestamps_batched(
        transcript_path, prompt_desc=_FUNNY_PROMPT_DESC, min_rating=min_rating, **kwargs
    )


def find_funny_timestamps(
    transcript_path: str | Path,
    *,
    min_rating: float = 8.0,
    **kwargs,
) -> List[ClipCandidate]:
    """Find humorous clip candidates."""
    return find_clip_timestamps(
        transcript_path, prompt_desc=_FUNNY_PROMPT_DESC, min_rating=min_rating, **kwargs
    )


def find_inspiring_timestamps_batched(
    transcript_path: str | Path,
    **kwargs,
) -> List[ClipCandidate]:
    """Find inspiring clip candidates using batched processing."""
    return find_clip_timestamps_batched(
        transcript_path, prompt_desc=_INSPIRING_PROMPT_DESC, **kwargs
    )


def find_inspiring_timestamps(
    transcript_path: str | Path,
    **kwargs,
) -> List[ClipCandidate]:
    """Find inspiring clip candidates."""
    return find_clip_timestamps(
        transcript_path, prompt_desc=_INSPIRING_PROMPT_DESC, **kwargs
    )


def find_educational_timestamps_batched(
    transcript_path: str | Path,
    **kwargs,
) -> List[ClipCandidate]:
    """Find educational clip candidates using batched processing."""
    return find_clip_timestamps_batched(
        transcript_path, prompt_desc=_EDUCATIONAL_PROMPT_DESC, **kwargs
    )


def find_educational_timestamps(
    transcript_path: str | Path,
    **kwargs,
) -> List[ClipCandidate]:
    """Find educational clip candidates."""
    return find_clip_timestamps(
        transcript_path, prompt_desc=_EDUCATIONAL_PROMPT_DESC, **kwargs
    )
