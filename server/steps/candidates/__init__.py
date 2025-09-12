from __future__ import annotations

from typing import Dict, List, Optional, Tuple
from pathlib import Path
import re

from helpers.ai import local_llm_call_json, retry
from interfaces.clip_candidate import ClipCandidate
from config import (
    DEFAULT_MIN_RATING,
    DEFAULT_MIN_WORDS,
    LLM_API_TIMEOUT,
    MAX_DURATION_SECONDS,
    MAX_LLM_CHARS,
    MIN_DURATION_SECONDS,
    LOCAL_LLM_MODEL,
)

from .helpers import (
    _get_field,
    _to_float,
    parse_transcript,
    _merge_adjacent_candidates,
    _enforce_non_overlap,
)
from .prompts import _build_system_instructions, FUNNY_PROMPT_DESC

JSON_OBJECT_EXTRACT = re.compile(r"\{(?:.|\n)*\}")
PROMO_RE = re.compile(
    r"\b(sponsor(?:ed|s)?|sponsorships?|patreon|ads?|advertisement|advertising|brought to you by)\b",
    re.IGNORECASE,
)

__all__ = ["ClipCandidate"]


# -----------------------------
# Transcript chunking utilities
# -----------------------------

def _chunk_transcript_items(
    items: List[Tuple[float, float, str]],
    *,
    max_chars: int = MAX_LLM_CHARS,
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


def _promo_ranges(
    items: List[Tuple[float, float, str]],
    *,
    buffer_before: float = 2.0,
    buffer_after: float = 30.0,
) -> List[Tuple[float, float]]:
    """Return merged time ranges that likely contain promotional content.

    Any transcript line matching ``PROMO_RE`` is expanded slightly in both
    directions to account for sponsor messages that continue without
    repeating keywords.  Overlapping ranges are merged before returning.
    """
    spans: List[Tuple[float, float]] = []
    for s, e, txt in items:
        if PROMO_RE.search(txt):
            spans.append((max(0.0, s - buffer_before), e + buffer_after))
    if not spans:
        return []
    spans.sort()
    merged: List[Tuple[float, float]] = [spans[0]]
    for s, e in spans[1:]:
        last_s, last_e = merged[-1]
        if s <= last_e:
            merged[-1] = (last_s, max(last_e, e))
        else:
            merged.append((s, e))
    return merged


def _filter_promotional_candidates(
    candidates: List[ClipCandidate],
    items: List[Tuple[float, float, str]],
) -> List[ClipCandidate]:
    """Remove candidates that appear to contain ad reads or sponsor shoutouts."""
    filtered: List[ClipCandidate] = []
    promo_spans = _promo_ranges(items)

    def overlaps_promo(c: ClipCandidate) -> bool:
        for a, b in promo_spans:
            if not (c.end <= a or c.start >= b):
                return True
        return False

    for c in candidates:
        text = _candidate_text(c, items).lower()
        if PROMO_RE.search(text):
            continue
        if overlaps_promo(c):
            continue
        filtered.append(c)
    return filtered


def _verify_tone(
    candidates: List[ClipCandidate],
    items: List[Tuple[float, float, str]],
    prompt_desc: str,
    *,
    min_words: int,
    model: str,
    request_timeout: int,
) -> List[Optional[ClipCandidate]]:
    """Run a secondary LLM check to ensure each candidate matches the tone.

    Returns a list where ``None`` entries indicate clips that could not be
    confidently verified (e.g. too short or ambiguous responses).
    """
    results: List[Optional[ClipCandidate]] = []
    for c in candidates:
        text = _candidate_text(c, items)
        if len(text.split()) < min_words:
            print(f"[ToneCheck] candidate below min_words ({min_words}), marking uncertain: {c}")
            results.append(None)
            continue
        prompt = (
            f"Target tone: {prompt_desc}\n"
            "Respond with JSON {\"match\": true|false}.\n"
            f"Text: {text}"
        )
        try:
            try:
                out = local_llm_call_json(
                    model=model,
                    prompt=prompt,
                    options={"temperature": 0.0},
                    timeout=request_timeout,
                    extract_re=JSON_OBJECT_EXTRACT,
                )
            except TypeError:
                out = local_llm_call_json(
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
            results.append(c)
            continue
        if isinstance(out, list) and out:
            out = out[0]

        match_field = _get_field(out, "match")
        if match_field is None:
            print(f"[ToneCheck] missing 'match' field for candidate: {c}")
            results.append(None)
            continue
        if bool(match_field):
            results.append(c)
        else:
            results.append(None)
    return results
