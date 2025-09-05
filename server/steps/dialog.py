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


def _llm_dialog_ranges(
    items: List[Tuple[float, float, str]], *, model: str = "google/gemma-3-4b", timeout: int = 120
) -> List[Tuple[float, float]]:
    """Detect dialog ranges using an LLM."""
    prompt_lines = [
        "Determine the start and end times of coherent dialog in the following",  # noqa: E501
        "transcript lines. Return a JSON array of objects with `start` and",
        "`end` fields. Only output JSON.",
        "",
        "Lines:",
    ]
    prompt_lines.extend(f"[{s:.2f}-{e:.2f}] {t}" for s, e, t in items)
    prompt = "\n".join(prompt_lines)

    out = local_llm_call_json(
        model=model,
        prompt=prompt,
        options={"temperature": 0.0},
        timeout=timeout,
    )

    ranges: List[Tuple[float, float]] = []
    if isinstance(out, list):
        for obj in out:
            try:
                s = float(obj.get("start"))
                e = float(obj.get("end"))
            except Exception:
                continue
            ranges.append((s, e))
    return ranges


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
