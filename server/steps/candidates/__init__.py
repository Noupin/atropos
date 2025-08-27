from __future__ import annotations

from typing import List, Optional, Tuple
from pathlib import Path
import re

from helpers.ai import ollama_call_json, retry
from interfaces.clip_candidate import ClipCandidate

from .helpers import (
    _get_field,
    _to_float,
    parse_transcript,
    _merge_adjacent_candidates,
    _enforce_non_overlap,
)
from .prompts import _build_system_instructions, FUNNY_PROMPT_DESC

JSON_OBJECT_EXTRACT = re.compile(r"\{(?:.|\n)*\}")

__all__ = ["ClipCandidate", "find_clip_timestamps_batched", "find_clip_timestamps"]


# -----------------------------
# Transcript chunking utilities
# -----------------------------

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
            chunks.append(buf[:])
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


def _candidate_text(c: ClipCandidate, items: List[Tuple[float, float, str]]) -> str:
    """Return the concatenated transcript text that overlaps a candidate."""
    parts: List[str] = []
    for s, e, txt in items:
        if e <= c.start or s >= c.end:
            continue
        parts.append(txt)
    return " ".join(parts).strip()


def _verify_tone(
    candidates: List[ClipCandidate],
    items: List[Tuple[float, float, str]],
    prompt_desc: str,
    *,
    min_words: int,
    model: str,
    request_timeout: int,
) -> List[ClipCandidate]:
    """Run a secondary LLM check to ensure each candidate matches the tone."""
    passed: List[ClipCandidate] = []
    for c in candidates:
        text = _candidate_text(c, items)
        # If the candidate text is too short for a meaningful tone
        # verification we simply keep it. The upstream rating should
        # already have filtered obviously bad clips and we don't want to
        # drop otherwise valid candidates just because the tone check
        # cannot be applied.
        if len(text.split()) < min_words:
            passed.append(c)
            continue
        prompt = (
            f"Target tone: {prompt_desc}\n"
            "Respond with JSON {\"match\": true|false}.\n"
            f"Text: {text}"
        )
        try:
            try:
                out = ollama_call_json(
                    model=model,
                    prompt=prompt,
                    options={"temperature": 0.0},
                    timeout=request_timeout,
                    extract_re=JSON_OBJECT_EXTRACT,
                )
            except TypeError:
                out = ollama_call_json(
                    model=model,
                    prompt=prompt,
                    options={"temperature": 0.0},
                    timeout=request_timeout,
                )
        except Exception as e:
            # If the tone verification step fails (e.g. network/LLM
            # error) we don't want to lose the candidate entirely. Treat
            # it as a pass and keep the candidate.
            print(f"[ToneCheck] keeping candidate due to error: {e}")
            passed.append(c)
            continue
        if isinstance(out, list) and out:
            out = out[0]

        # When the model fails to supply an explicit "match" field we
        # err on the side of keeping the candidate. Only when the model
        # explicitly returns a falsey value do we drop it.
        match_field = _get_field(out, "match")
        if match_field is None:
            passed.append(c)
            continue
        if bool(match_field):
            passed.append(c)
    return passed


# -----------------------------
# LLM (Ollama / gemma3) utilities
# -----------------------------

def find_clip_timestamps_batched(
    transcript_path: str | Path,
    *,
    prompt_desc: str = FUNNY_PROMPT_DESC,
    min_rating: float = 7.0,
    min_words: int = 0,
    model: str = "gemma3",
    options: Optional[dict] = None,
    max_chars_per_chunk: int = 12000,
    overlap_lines: int = 4,
    request_timeout: int = 180,
    exclude_ranges: Optional[List[Tuple[float, float]]] = None,
    silences: Optional[List[Tuple[float, float]]] = None,
    words: Optional[List[dict]] = None,
    return_all_stages: bool = False,
) -> List[ClipCandidate] | tuple[List[ClipCandidate], List[ClipCandidate], List[ClipCandidate]]:
    """Chunk the transcript and query the model per-chunk to avoid context/HTTP timeouts."""
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
    all_candidates = _merge_adjacent_candidates(
        all_candidates,
        items,
        merge_gap_seconds=1.0,
        max_duration_seconds=60.0,
        words=words,
        silences=silences,
    )
    top_candidates = _enforce_non_overlap(
        all_candidates, items, words=words, silences=silences
    )
    print(f"[Batch] {len(top_candidates)} candidates remain after overlap enforcement.")
    verified_candidates = _verify_tone(
        top_candidates,
        items,
        prompt_desc,
        min_words=min_words,
        model=model,
        request_timeout=request_timeout,
    )
    print(
        f"[Batch] {len(verified_candidates)} candidates remain after tone verification."
    )
    if return_all_stages:
        return verified_candidates, top_candidates, all_candidates
    return verified_candidates


def find_clip_timestamps(
    transcript_path: str | Path,
    *,
    prompt_desc: str = FUNNY_PROMPT_DESC,
    min_rating: float = 7.0,
    min_words: int = 0,
    model: str = "gemma3",
    options: Optional[dict] = None,
    silences: Optional[List[Tuple[float, float]]] = None,
    words: Optional[List[dict]] = None,
    return_all_stages: bool = False,
) -> List[ClipCandidate] | tuple[List[ClipCandidate], List[ClipCandidate], List[ClipCandidate]]:
    """Use a local Ollama model (gemma3) to score transcript lines and propose clip windows."""
    items = parse_transcript(transcript_path)
    if not items:
        return []

    min_ts = items[0][0]
    max_ts = max(e for _, e, _ in items)

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
            continue
        if not (min_ts <= start < end <= max_ts):
            continue
        if rating < min_rating:
            continue
        candidates.append(
            ClipCandidate(
                start=start, end=end, rating=rating, reason=reason, quote=quote
            )
        )

    all_candidates = _merge_adjacent_candidates(
        candidates,
        items,
        merge_gap_seconds=1.0,
        max_duration_seconds=60.0,
        words=words,
        silences=silences,
    )
    top_candidates = _enforce_non_overlap(
        all_candidates, items, words=words, silences=silences
    )
    verified_candidates = _verify_tone(
        top_candidates,
        items,
        prompt_desc,
        min_words=min_words,
        model=model,
        request_timeout=180,
    )
    if return_all_stages:
        return verified_candidates, top_candidates, all_candidates
    return verified_candidates
