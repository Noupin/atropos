from __future__ import annotations

from pathlib import Path
from typing import List, Tuple, Any

from helpers.ai import local_llm_call_json
from config import (
    EDUCATIONAL_MIN_RATING,
    EDUCATIONAL_MIN_WORDS,
    MIN_DURATION_SECONDS,
    RATING_MIN,
    RATING_MAX,
    WINDOW_SIZE_SECONDS,
    WINDOW_OVERLAP_SECONDS,
    WINDOW_CONTEXT_SECONDS,
)
from . import ClipCandidate
from .helpers import (
    parse_transcript,
    _get_field,
    _to_float,
    _merge_adjacent_candidates,
    _enforce_non_overlap,
    snap_start_to_dialog_start,
    snap_end_to_dialog_end,
    _snap_start_to_sentence_start,
    _snap_end_to_sentence_end,
)
from ..silence import snap_start_to_silence, snap_end_to_silence
from .prompts import EDUCATIONAL_PROMPT_DESC, build_window_prompt


def _window_items(
    items: List[Tuple[float, float, str]],
    window: float = WINDOW_SIZE_SECONDS,
    overlap: float = WINDOW_OVERLAP_SECONDS,
) -> List[Tuple[float, float, List[Tuple[float, float, str]]]]:
    if not items:
        return []
    start = items[0][0]
    end = items[-1][1]
    step = window - overlap
    windows: List[Tuple[float, float, List[Tuple[float, float, str]]]] = []
    t = start
    while t < end:
        w_end = t + window
        win = [it for it in items if it[1] > t and it[0] < w_end]
        if win:
            windows.append((t, w_end, win))
        t += step
    return windows


def find_educational_timestamps_batched(
    transcript_path: str | Path,
    *,
    min_rating: float = EDUCATIONAL_MIN_RATING,
    min_words: int = EDUCATIONAL_MIN_WORDS,
    return_all_stages: bool = False,
    segments: Any | None = None,
    dialog_ranges: Any | None = None,
    silences: Any | None = None,
    **kwargs: Any,
) -> List[ClipCandidate] | tuple[List[ClipCandidate], List[ClipCandidate], List[ClipCandidate]]:
    items = parse_transcript(transcript_path)
    windows = _window_items(items)
    all_candidates: List[ClipCandidate] = []
    for win_start, win_end, win_items in windows:
        ctx_items = [
            it
            for it in items
            if it[1] > win_start - WINDOW_CONTEXT_SECONDS and it[0] < win_end + WINDOW_CONTEXT_SECONDS
        ]
        text = "\n".join(f"[{s:.2f}-{e:.2f}] {t}" for s, e, t in ctx_items)
        prompt = build_window_prompt(EDUCATIONAL_PROMPT_DESC, text)
        print(
            f"[Finder] processing window {win_start:.2f}-{win_end:.2f}:\n{text}"
        )
        try:
            arr = local_llm_call_json(
                model="google/gemma-3-4b",
                prompt=prompt,
                options={"temperature": 0.2},
            )
        except Exception as e:
            print(f"[Finder] window {win_start:.2f}-{win_end:.2f} failed: {e}")
            continue
        for it in arr:
            start = _to_float(_get_field(it, "start"))
            end = _to_float(_get_field(it, "end"))
            rating = _to_float(_get_field(it, "rating"))
            reason = str(_get_field(it, "reason", ""))
            quote = str(_get_field(it, "quote", ""))
            if start is None or end is None or rating is None:
                continue
            start = float(start)
            end = float(end)
            rating = round(float(rating), 1)
            if not (RATING_MIN <= rating <= RATING_MAX):
                continue
            if segments is not None:
                start = _snap_start_to_sentence_start(start, segments)
                end = _snap_end_to_sentence_end(end, segments)
            if dialog_ranges is not None:
                start = snap_start_to_dialog_start(start, dialog_ranges)
                end = snap_end_to_dialog_end(end, dialog_ranges)
            if silences is not None:
                start = snap_start_to_silence(start, silences)
                end = snap_end_to_silence(end, silences)
            all_candidates.append(
                ClipCandidate(
                    start=start, end=end, rating=rating, reason=reason, quote=quote
                )
            )
    filtered = [c for c in all_candidates if c.rating >= min_rating]
    merged = _merge_adjacent_candidates(filtered, items, silences=silences)
    top = _enforce_non_overlap(
        merged,
        items,
        silences=silences,
        min_duration_seconds=MIN_DURATION_SECONDS,
        min_rating=min_rating,
    )
    if return_all_stages:
        return top, merged, all_candidates
    return top


def find_educational_timestamps(
    transcript_path: str | Path,
    **kwargs: Any,
) -> List[ClipCandidate]:
    return find_educational_timestamps_batched(transcript_path, **kwargs)


__all__ = ["find_educational_timestamps_batched", "find_educational_timestamps"]
