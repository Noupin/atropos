import json
import re
from pathlib import Path
from typing import Iterable, List, Tuple
from concurrent.futures import TimeoutError as FuturesTimeout

import config
from helpers.ai import local_llm_call_json
from .candidates.helpers import parse_transcript
from common.chunk_utils import chunk_by_chars, chunk_is_sentence_like
from common.thread_pool import process_with_thread_pool
from common.llm_utils import (
    format_transcript_lines,
    default_llm_options,
    chunk_span,
    parse_llm_spans,
)

_KEYWORDS = {"haha", "lol", "joke", "laugh", "laughter"}
_PRONOUNS = {
    "i",
    "you",
    "we",
    "he",
    "she",
    "they",
    "me",
    "my",
    "your",
    "our",
    "us",
}
_RE_WORD = re.compile(r"\b\w+\b")


def _is_dialog_line(text: str) -> bool:
    """Return ``True`` if ``text`` likely belongs to dialog."""
    lowered = text.lower()
    words = set(_RE_WORD.findall(lowered))
    score = 0
    if "?" in text or "!" in text:
        score += 1
    if any(p in words for p in _PRONOUNS):
        score += 1
    if any(key in lowered for key in _KEYWORDS):
        score += 1
    if (
        '"' in text
        or "“" in text
        or "”" in text
        or text.strip().startswith(("'", "‘", "’"))
    ):
        score += 1
    if len(text) <= 80:
        score += 1
    return score >= 2



def _heuristic_dialog_ranges(
    items: List[Tuple[float, float, str]], gap: float
) -> List[Tuple[float, float]]:
    """Detect dialog ranges using a lightweight heuristic."""
    ranges: List[Tuple[float, float]] = []
    current_start: float | None = None
    current_end: float | None = None

    for start, end, text in items:
        if _is_dialog_line(text):
            if current_start is None:
                current_start, current_end = start, end
            elif start - current_end <= gap:
                current_end = end
            else:
                ranges.append((current_start, current_end))
                current_start, current_end = start, end
        else:
            if current_start is not None:
                ranges.append((current_start, current_end))
                current_start, current_end = None, None

    if current_start is not None:
        ranges.append((current_start, current_end))

    return ranges


def _merge_ranges(ranges: List[Tuple[float, float]]) -> List[Tuple[float, float]]:
    """Merge overlapping ranges."""
    if not ranges:
        return []
    ranges.sort(key=lambda r: r[0])
    merged: List[Tuple[float, float]] = []
    cur_s, cur_e = ranges[0]
    for s, e in ranges[1:]:
        if s <= cur_e:
            cur_e = max(cur_e, e)
        else:
            merged.append((cur_s, cur_e))
            cur_s, cur_e = s, e
    merged.append((cur_s, cur_e))
    return merged


def _llm_dialog_ranges(
    items: List[Tuple[float, float, str]],
    *,
    model: str = config.LOCAL_LLM_MODEL,
    timeout: int = config.LLM_API_TIMEOUT,
) -> List[Tuple[float, float]]:
    """Detect dialog ranges using an LLM with chunked prompts and parallelism.
    Uses only per-chunk timeout (config.LLM_PER_CHUNK_TIMEOUT). If that is 0/None,
    waits indefinitely per chunk. Falls back heuristically per chunk on error.
    """
    chunks = chunk_by_chars(
        items,
        max_chars=config.MAX_LLM_CHARS,
        overlap_lines=2,
        max_items=config.SEGMENT_OR_DIALOG_CHUNK_MAX_ITEMS,
    )
    print(f"[dialog] Starting detection with {len(chunks)} chunks.")
    if not config.LLM_PER_CHUNK_TIMEOUT:
        print("[dialog] Per-chunk timeout: DISABLED (waiting indefinitely per chunk).")
    else:
        print(f"[dialog] Per-chunk timeout: {config.LLM_PER_CHUNK_TIMEOUT}s")
    print(f"[dialog] Workers: {config.LLM_MAX_WORKERS}")

    def _build_prompt(chunk: List[Tuple[float, float, str]]) -> str:
        lines = [
            "You are given timestamped transcript lines.",
            "Task: identify contiguous dialog spans (multi-speaker back-and-forth).",
            "Rules:",
            "1) Prefer spans where turns alternate quickly (<10s gaps).",
            "2) Do not split words; align to sentence ends.",
            "3) Merge adjacent segments when they form a single conversation.",
            "4) Return ONLY a JSON array like: [{\"start\": float, \"end\": float}] using seconds with decimals.",
            "",
            "Segments:",
        ]
        lines.extend(format_transcript_lines(chunk))
        return "\n".join(lines)

    def _process_chunk(idx: int, chunk: List[Tuple[float, float, str]]):
        if chunk_is_sentence_like(chunk) and len(chunk) <= 6:
            print(f"[dialog] Chunk {idx}: heuristic skip (sentence-like).")
            s0, e0 = chunk_span(chunk)
            return [(s0, e0)]

        prompt = _build_prompt(chunk)
        call_timeout = config.LLM_PER_CHUNK_TIMEOUT if (config.LLM_PER_CHUNK_TIMEOUT and config.LLM_PER_CHUNK_TIMEOUT > 0) else None
        kwargs = dict(
            model=model,
            prompt=prompt,
            options=default_llm_options(384),
        )
        if call_timeout is not None:
            kwargs["timeout"] = call_timeout

        try:
            out = local_llm_call_json(**kwargs)
        except Exception as e:
            print(f"[dialog] Chunk {idx}: LLM exception -> {e}")
            s0, e0 = chunk_span(chunk)
            return [(s0, e0)]

        spans = parse_llm_spans(out)
        if not spans:
            s0, e0 = chunk_span(chunk)
            spans = [(s0, e0)]
        print(f"[dialog] Chunk {idx}: spans={len(spans)}")
        return spans

    all_ranges: List[Tuple[float, float]] = []

    def _on_error(idx: int, chunk: List[Tuple[float, float, str]], exc: Exception):
        if isinstance(exc, FuturesTimeout):
            print(f"[dialog] Chunk {idx}: timed out; using coarse span.")
        else:
            print(f"[dialog] Chunk {idx}: future error -> {exc}")
        s0, e0 = chunk_span(chunk)
        return [(s0, e0)]

    results = process_with_thread_pool(
        chunks,
        _process_chunk,
        max_workers=config.LLM_MAX_WORKERS,
        timeout=config.LLM_PER_CHUNK_TIMEOUT,
        on_error=_on_error,
    )
    for spans in results:
        all_ranges.extend(spans)

    merged = _merge_ranges(all_ranges)
    print(f"[dialog] Done. merged spans={len(merged)}")
    return merged


def detect_dialog_ranges(
    transcript_path: str | Path, *, gap: float = 1.0
) -> List[Tuple[float, float]]:
    """Detect dialog ranges in ``transcript_path``.

    When :data:`config.DETECT_DIALOG_WITH_LLM` is true, this function first
    attempts to use an LLM to determine ranges. If the LLM call fails or
    returns no data, a simple keyword heuristic is used as a fallback.
    """

    items = parse_transcript(transcript_path)

    if config.DETECT_DIALOG_WITH_LLM:
        try:
            print("[dialog] Using LLM path…")
            ranges = _llm_dialog_ranges(items)
            if ranges:
                first_start, last_end = items[0][0], items[-1][1]
                if not (len(ranges) == 1 and ranges[0] == (first_start, last_end)):
                    return ranges
                print("[dialog] LLM returned trivial span; using heuristic")
        except Exception as e:
            print(f"[dialog] LLM exception -> {e}; falling back to heuristic")

    print("[dialog] Fallback to heuristic")
    return _heuristic_dialog_ranges(items, gap)


def write_dialog_ranges_json(ranges: Iterable[Tuple[float, float]], path: str | Path) -> None:
    """Write ``ranges`` to ``path`` in JSON format."""
    data = [{"start": s, "end": e} for s, e in ranges]
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f)


def load_dialog_ranges_json(path: str | Path) -> List[Tuple[float, float]]:
    """Load dialog ranges from a JSON file previously written by
    :func:`write_dialog_ranges_json`."""
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    return [(float(item["start"]), float(item["end"])) for item in data]
