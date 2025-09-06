import json
from pathlib import Path
from typing import Iterable, List, Tuple
import time
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeout

import config
from helpers.ai import local_llm_call_json
from .candidates.helpers import parse_transcript

_KEYWORDS = {"haha", "lol", "joke", "laugh", "laughter"}

_END_PUNCT = set(".!?")

def _chunk_is_sentence_like(chunk: List[Tuple[float, float, str]]) -> bool:
    """Return True if the chunk already looks like sentence-bounded text."""
    if not chunk:
        return True
    ends_ok = sum(1 for _, _, t in chunk if t and t.strip()[-1:] in _END_PUNCT)
    ratio = ends_ok / max(1, len(chunk))
    avg_len = sum(len(t) for _, _, t in chunk) / max(1, len(chunk))
    return ratio >= 0.7 and 24 <= avg_len <= 240


def _heuristic_dialog_ranges(
    items: List[Tuple[float, float, str]], gap: float
) -> List[Tuple[float, float]]:
    """Detect dialog ranges using a simple keyword heuristic."""
    ranges: List[Tuple[float, float]] = []
    current_start: float | None = None
    current_end: float | None = None

    for start, end, text in items:
        lowered = text.lower()
        is_dialog = (
            "?" in text
            or "!" in text
            or any(key in lowered for key in _KEYWORDS)
        )
        if is_dialog:
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


def _chunk_items(
    items: List[Tuple[float, float, str]], *, max_chars: int, overlap_lines: int = 2, max_items: int | None = None
) -> List[List[Tuple[float, float, str]]]:
    """Chunk transcript items under ``max_chars`` and ``max_items`` with a small line overlap."""
    chunks: List[List[Tuple[float, float, str]]] = []
    buf: List[Tuple[float, float, str]] = []
    count = 0
    for triplet in items:
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
    chunks = _chunk_items(
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
        lines.extend(f"[{s:.2f}-{e:.2f}] {t}" for s, e, t in chunk)
        return "\n".join(lines)

    def _process_chunk(idx: int, chunk: List[Tuple[float, float, str]]):
        if _chunk_is_sentence_like(chunk) and len(chunk) <= 6:
            print(f"[dialog] Chunk {idx}: heuristic skip (sentence-like).")
            s0 = min(s for s, _, _ in chunk)
            e0 = max(e for _, e, _ in chunk)
            return [(s0, e0)]

        prompt = _build_prompt(chunk)
        call_timeout = config.LLM_PER_CHUNK_TIMEOUT if (config.LLM_PER_CHUNK_TIMEOUT and config.LLM_PER_CHUNK_TIMEOUT > 0) else None
        kwargs = dict(
            model=model,
            prompt=prompt,
            options={"temperature": 0.0, "top_p": 0.9, "num_predict": 384},
        )
        if call_timeout is not None:
            kwargs["timeout"] = call_timeout

        try:
            out = local_llm_call_json(**kwargs)
        except Exception as e:
            print(f"[dialog] Chunk {idx}: LLM exception -> {e}")
            s0 = min(s for s, _, _ in chunk)
            e0 = max(e for _, e, _ in chunk)
            return [(s0, e0)]

        spans: List[Tuple[float, float]] = []
        if isinstance(out, list):
            for obj in out:
                try:
                    s = float(obj.get("start"))
                    e = float(obj.get("end"))
                    if e >= s:
                        spans.append((s, e))
                except Exception:
                    continue

        if not spans:
            s0 = min(s for s, _, _ in chunk)
            e0 = max(e for _, e, _ in chunk)
            spans = [(s0, e0)]
        print(f"[dialog] Chunk {idx}: spans={len(spans)}")
        return spans

    all_ranges: List[Tuple[float, float]] = []
    with ThreadPoolExecutor(max_workers=config.LLM_MAX_WORKERS) as ex:
        futures = []
        for i, chunk in enumerate(chunks, 1):
            futures.append(ex.submit(_process_chunk, i, chunk))

        for i, fut in enumerate(futures, 1):
            try:
                if config.LLM_PER_CHUNK_TIMEOUT and config.LLM_PER_CHUNK_TIMEOUT > 0:
                    res = fut.result(timeout=config.LLM_PER_CHUNK_TIMEOUT)
                else:
                    res = fut.result()
                all_ranges.extend(res)
            except FuturesTimeout:
                print(f"[dialog] Chunk {i}: timed out; using coarse span.")
                ch = chunks[i - 1]
                s0 = min(s for s, _, _ in ch)
                e0 = max(e for _, e, _ in ch)
                all_ranges.append((s0, e0))
            except Exception as e:
                print(f"[dialog] Chunk {i}: future error -> {e}")
                ch = chunks[i - 1]
                s0 = min(s for s, _, _ in ch)
                e0 = max(e for _, e, _ in ch)
                all_ranges.append((s0, e0))

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
                return ranges
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
