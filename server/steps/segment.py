from __future__ import annotations

import json
import re
import time
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeout
from pathlib import Path
from typing import List, Tuple

import config
from helpers.ai import local_llm_call_json

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


def _chunk_segments(
    segments: List[Tuple[float, float, str]], *, max_chars: int, overlap_lines: int = 2, max_items: int | None = None
) -> List[List[Tuple[float, float, str]]]:
    """Chunk segments under ``max_chars`` and optional ``max_items`` with small overlaps."""
    chunks: List[List[Tuple[float, float, str]]] = []
    buf: List[Tuple[float, float, str]] = []
    count = 0
    for triplet in segments:
        s, e, t = triplet
        line = f"[{s:.2f}-{e:.2f}] {t}"
        ln = len(line) + 1
        would_exceed_chars = buf and count + ln > max_chars
        would_exceed_items = max_items is not None and buf and len(buf) >= max_items
        if would_exceed_chars or would_exceed_items:
            chunks.append(buf[:])
            tail = buf[-overlap_lines:] if overlap_lines > 0 else []
            buf = tail[:]
            count = sum(len(f"[{a:.2f}-{b:.2f}] {c}") + 1 for a, b, c in buf)
        buf.append(triplet)
        count += ln
    if buf:
        chunks.append(buf)
    return chunks


_END_PUNCT = set(".!?")
def _chunk_is_sentence_like(chunk: List[Tuple[float, float, str]]) -> bool:
    if not chunk:
        return True
    ends_ok = sum(1 for _, _, t in chunk if t and t.strip()[-1:] in _END_PUNCT)
    ratio = ends_ok / max(1, len(chunk))
    avg_len = sum(len(t) for _, _, t in chunk) / max(1, len(chunk))
    # Skip LLM if ≥70% already end with sentence punctuation and avg length is reasonable
    return ratio >= 0.7 and 24 <= avg_len <= 240


def refine_segments_with_llm(
    segments: List[Tuple[float, float, str]],
    *,
    model: str = config.LOCAL_LLM_MODEL,
    timeout: int = config.LLM_API_TIMEOUT,
) -> List[Tuple[float, float, str]]:
    """Use an LLM to merge or split segments into complete sentences.

    Returns adjusted segments or the original segments on failure/timeout.
    """
    chunks = _chunk_segments(
        segments, max_chars=config.MAX_LLM_CHARS, overlap_lines=2, max_items=config.SEGMENT_OR_DIALOG_CHUNK_MAX_ITEMS
    )

    print(f"[segments] Starting refinement with {len(chunks)} chunks.")

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
        lines.extend(f"[{s:.2f}-{e:.2f}] {t}" for s, e, t in chunk)
        return "\n".join(lines)

    def _process_chunk(idx: int, chunk: List[Tuple[float, float, str]]):
        # Skip LLM if chunk already looks good
        if _chunk_is_sentence_like(chunk):
            print(f"[segments] Chunk {idx}: skipping LLM, looks sentence-like.")
            return chunk

        print(f"[segments] Chunk {idx}: calling LLM for refinement.")
        prompt = _build_prompt(chunk)
        try:
            out = local_llm_call_json(
                model=model,
                prompt=prompt,
                options={
                    "temperature": 0.0,
                    "top_p": 0.9,
                    "num_predict": 512,
                },
                timeout=min(timeout, config.LLM_PER_CHUNK_TIMEOUT),
            )
        except Exception as e:
            print(f"[segments] Chunk {idx}: LLM exception -> {e}")
            return chunk

        refined: List[Tuple[float, float, str]] = []
        if isinstance(out, list):
            for obj in out:
                try:
                    s = float(obj.get("start"))
                    e = float(obj.get("end"))
                    t = str(obj.get("text", "")).strip()
                except Exception:
                    continue
                if t and e >= s:
                    refined.append((s, e, t))
        print(f"[segments] Chunk {idx}: LLM returned {len(refined)} refined sentences (original {len(chunk)}).")
        return refined or chunk

    all_refined: List[Tuple[float, float, str]] = []
    seen: set[tuple[float, float, str]] = set()

    if config.LLM_PER_CHUNK_TIMEOUT in (0, None):
        print("[segments] Per-chunk timeout is disabled; waiting indefinitely for each chunk.")
    with ThreadPoolExecutor(max_workers=config.LLM_MAX_WORKERS) as ex:
        futures = []
        for i, chunk in enumerate(chunks):
            futures.append(ex.submit(_process_chunk, i + 1, chunk))

        for i, fut in enumerate(futures, 1):
            try:
                timeout_val = config.LLM_PER_CHUNK_TIMEOUT
                if timeout_val in (0, None):
                    chunk_out = fut.result()
                else:
                    chunk_out = fut.result(timeout=timeout_val)
            except FuturesTimeout:
                print(f"[segments] Chunk {i}: timeout; using original.")
                chunk_out = chunks[i - 1]
            except Exception as e:
                print(f"[segments] Chunk {i}: error {e}; using original.")
                chunk_out = chunks[i - 1]

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
