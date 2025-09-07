from __future__ import annotations

import json
import re
from concurrent.futures import TimeoutError as FuturesTimeout
from pathlib import Path
from typing import List, Tuple

import config
from helpers.ai import local_llm_call_json
from common.chunk_utils import chunk_by_chars, chunk_is_sentence_like
from common.thread_pool import process_with_thread_pool
from common.llm_utils import (
    format_transcript_lines,
    default_llm_options,
    parse_llm_spans,
)

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


def refine_segments_with_llm(
    segments: List[Tuple[float, float, str]],
    *,
    model: str = config.LOCAL_LLM_MODEL,
    timeout: int = config.LLM_API_TIMEOUT,
) -> List[Tuple[float, float, str]]:
    """Use an LLM to merge or split segments into complete sentences.

    Returns adjusted segments or the original segments on failure/timeout.
    """
    chunks = chunk_by_chars(
        segments, max_chars=config.MAX_LLM_CHARS, overlap_lines=2, max_items=config.SEGMENT_OR_DIALOG_CHUNK_MAX_ITEMS
    )

    print(f"[segments] Starting refinement with {len(chunks)} chunks.")

    # Quick connectivity check so we fail fast if the local LLM server is down.
    try:
        local_llm_call_json(
            model=model,
            prompt="return []",
            options=default_llm_options(16),
            timeout=min(timeout, 5),
        )
    except Exception as e:
        print(f"[segments] LLM unavailable: {e}; skipping refinement.")
        return segments

    def _build_prompt(chunk: List[Tuple[float, float, str]]) -> str:
        # Compact, JSON-only prompt to reduce tokens and latency
        lines = [
            "You are given transcript lines with timestamps.",
            "Goal: merge/split into complete sentences/phrases only.",
            "Rules:",
            "1) Keep natural sentence boundaries; do not cut words.",
            "2) When merging, start=min(starts), end=max(ends).",
            "3) When splitting a span, divide time proportionally by sentence length.",
            "4) Return ONLY JSON array: [{\"start\": float, \"end\": float, \"text\": string}, ...].",
            "5) Use seconds with decimals (e.g., 12.3).",
            "",
            "Segments:",
        ]
        lines.extend(format_transcript_lines(chunk))
        return "\n".join(lines)

    def _process_chunk(idx: int, chunk: List[Tuple[float, float, str]]):
        # Skip LLM if chunk already looks good
        if chunk_is_sentence_like(chunk):
            print(f"[segments] Chunk {idx}: skipping LLM, looks sentence-like.")
            return chunk

        print(f"[segments] Chunk {idx}: calling LLM for refinement.")
        prompt = _build_prompt(chunk)
        try:
            out = local_llm_call_json(
                model=model,
                prompt=prompt,
                options=default_llm_options(512),
                timeout=min(timeout, config.LLM_PER_CHUNK_TIMEOUT),
            )
        except Exception as e:
            print(f"[segments] Chunk {idx}: LLM exception -> {e}")
            return chunk

        refined = parse_llm_spans(out, with_text=True)
        print(f"[segments] Chunk {idx}: LLM returned {len(refined)} refined sentences (original {len(chunk)}).")
        return refined or chunk

    all_refined: List[Tuple[float, float, str]] = []
    seen: set[tuple[float, float, str]] = set()

    if config.LLM_PER_CHUNK_TIMEOUT in (0, None):
        print("[segments] Per-chunk timeout is disabled; waiting indefinitely for each chunk.")

    def _on_error(idx: int, chunk: List[Tuple[float, float, str]], exc: Exception):
        if isinstance(exc, FuturesTimeout):
            print(f"[segments] Chunk {idx}: timeout; using original.")
        else:
            print(f"[segments] Chunk {idx}: error {exc}; using original.")
        return chunk

    results = process_with_thread_pool(
        chunks,
        _process_chunk,
        max_workers=config.LLM_MAX_WORKERS,
        timeout=config.LLM_PER_CHUNK_TIMEOUT,
        on_error=_on_error,
    )

    for chunk_out in results:
        for s, e, t in chunk_out:
            key = (s, e, t)
            if key not in seen:
                all_refined.append((s, e, t))
                seen.add(key)

    print(f"[segments] Refinement complete: total {len(all_refined)} final segments.")
    return all_refined or segments


def maybe_refine_segments_with_llm(
    segments: List[Tuple[float, float, str]], **kwargs
) -> List[Tuple[float, float, str]]:
    """Refine segments with an LLM if enabled in configuration."""
    if not config.USE_LLM_FOR_SEGMENTS:
        return segments
    return refine_segments_with_llm(segments, **kwargs)


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
