import json
from pathlib import Path
from typing import Iterable, List, Tuple

import config
from helpers.ai import local_llm_call_json
from .candidates.helpers import parse_transcript

_KEYWORDS = {"haha", "lol", "joke", "laugh", "laughter"}



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
    items: List[Tuple[float, float, str]], *, max_chars: int, overlap_lines: int = 2
) -> List[List[Tuple[float, float, str]]]:
    """Chunk transcript items under ``max_chars`` with small line overlaps."""
    chunks: List[List[Tuple[float, float, str]]] = []
    buf: List[Tuple[float, float, str]] = []
    count = 0
    for triplet in items:
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
    items: List[Tuple[float, float, str]], *, model: str = "google/gemma-3-4b", timeout: int = config.LLM_API_TIMEOUT
) -> List[Tuple[float, float]]:
    """Detect dialog ranges using an LLM with chunked prompts."""
    chunks = _chunk_items(items, max_chars=config.MAX_LLM_CHARS)
    all_ranges: List[Tuple[float, float]] = []
    for i, chunk in enumerate(chunks):
        print(f"Chunk {i+1}/{len(chunks)}")
        prompt_lines = [
            "Determine the start and end times of coherent dialog in the following",  # noqa: E501
            "transcript lines. Return a JSON array of objects with `start` and",
            "`end` fields. Only output JSON.",
            "",
            "Lines:",
        ]
        prompt_lines.extend(
            [f"[{s:.2f}-{e:.2f}] {t}" for s, e, t in chunk]
        )
        prompt = "\n".join(prompt_lines)
        out = local_llm_call_json(
            model=model,
            prompt=prompt,
            options={"temperature": 0.0},
            timeout=timeout,
        )
        if isinstance(out, list):
            for obj in out:
                try:
                    s = float(obj.get("start"))
                    e = float(obj.get("end"))
                except Exception:
                    continue
                all_ranges.append((s, e))
    return _merge_ranges(all_ranges)


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
            ranges = _llm_dialog_ranges(items)
            if ranges:
                return ranges
        except Exception as e:
            print("Exception:", e)

    print("LLM Dialog failed defaulting to heuristic")
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
