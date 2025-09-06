from __future__ import annotations

import json
import re
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
    segments: List[Tuple[float, float, str]], *, max_chars: int, overlap_lines: int = 2
) -> List[List[Tuple[float, float, str]]]:
    """Chunk segments under ``max_chars`` with small overlaps."""
    chunks: List[List[Tuple[float, float, str]]] = []
    buf: List[Tuple[float, float, str]] = []
    count = 0
    for triplet in segments:
        s, e, t = triplet
        line = f"[{s:.2f}-{e:.2f}] {t}"
        ln = len(line) + 1
        if buf and count + ln > max_chars:
            chunks.append(buf[:])
            tail = buf[-overlap_lines:] if overlap_lines > 0 else []
            buf = tail[:]
            count = sum(len(f"[{a:.2f}-{b:.2f}] {c}") + 1 for a, b, c in buf)
        buf.append(triplet)
        count += ln
    if buf:
        chunks.append(buf)
    return chunks


def refine_segments_with_llm(
    segments: List[Tuple[float, float, str]],
    *,
    model: str = "google/gemma-3-4b",
    timeout: int = config.LLM_API_TIMEOUT,
) -> List[Tuple[float, float, str]]:
    """Use an LLM to merge or split segments into complete sentences.

    Parameters
    ----------
    segments:
        Existing list of ``(start, end, text)`` entries.
    model:
        Local LLM model identifier.
    timeout:
        Request timeout in seconds for the LLM call.

    Returns
    -------
    List[Tuple[float, float, str]]
        Adjusted segments or the original ``segments`` if the LLM call fails
        or returns an empty list.
    """

    chunks = _chunk_segments(segments, max_chars=config.MAX_LLM_CHARS)
    all_refined: List[Tuple[float, float, str]] = []
    seen: set[tuple[float, float, str]] = set()
    for chunk in chunks:
        print(f"Chunk {chunk}/{chunks}")
        prompt_lines = [
            "Combine or split the following transcript segments so each is a",
            "complete sentence or phrase. Return a JSON array of objects with",
            "`start`, `end`, and `text` fields. Use provided times when merging",
            "segments; if splitting, divide the time span proportionally by",
            "sentence length. Output only JSON.",
            "",
            "Segments:",
        ]
        prompt_lines.extend(
            [f"[{s:.2f}-{e:.2f}] {t}" for s, e, t in chunk]
        )
        prompt = "\n".join(prompt_lines)
        try:
            out = local_llm_call_json(
                model=model,
                prompt=prompt,
                options={"temperature": 0.0},
                timeout=timeout,
            )
        except Exception as e:
            print("Exception:", e)
            all_refined.extend(chunk)
            continue
        refined_chunk: List[Tuple[float, float, str]] = []
        if isinstance(out, list):
            for obj in out:
                try:
                    s = float(obj.get("start"))
                    e = float(obj.get("end"))
                    t = str(obj.get("text", "")).strip()
                except Exception:
                    continue
                if t:
                    key = (s, e, t)
                    if key not in seen:
                        refined_chunk.append((s, e, t))
                        seen.add(key)
        if refined_chunk:
            all_refined.extend(refined_chunk)
        else:
            all_refined.extend(chunk)
    return all_refined or segments


def maybe_refine_segments_with_llm(
    segments: List[Tuple[float, float, str]], **kwargs
) -> List[Tuple[float, float, str]]:
    """Refine segments with an LLM if enabled in configuration."""
    if not config.REFINE_SEGMENTS_WITH_LLM:
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
