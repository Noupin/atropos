from __future__ import annotations

import time
from pathlib import Path
from typing import Any, List, Tuple

from config import (
    WINDOW_CONTEXT_SECONDS,
    WINDOW_OVERLAP_SECONDS,
    WINDOW_SIZE_SECONDS,
    MIN_DURATION_SECONDS,
    LOCAL_LLM_MODEL,
    FUNNY_MIN_RATING,
    FUNNY_MIN_WORDS,
)

from server.types.tone import Tone, ToneStrategy

from . import ClipCandidate, _filter_promotional_candidates
from .helpers import (
    _enforce_non_overlap,
    _get_field,
    _merge_adjacent_candidates,
    _to_float,
    parse_transcript,
    snap_end_to_dialog_end,
    snap_start_to_dialog_start,
    _snap_end_to_sentence_end,
    _snap_start_to_sentence_start,
)
from ..silence import snap_start_to_silence, snap_end_to_silence
from .prompts import (
    FUNNY_PROMPT_DESC,
    SPACE_PROMPT_DESC,
    HISTORY_PROMPT_DESC,
    TECH_PROMPT_DESC,
    HEALTH_PROMPT_DESC,
    build_window_prompt,
)


STRATEGY_REGISTRY: dict[Tone, ToneStrategy] = {
    Tone.FUNNY: ToneStrategy(
        prompt_desc=FUNNY_PROMPT_DESC,
        min_rating=FUNNY_MIN_RATING,
        min_words=FUNNY_MIN_WORDS,
    ),
    Tone.SPACE: ToneStrategy(prompt_desc=SPACE_PROMPT_DESC),
    Tone.HISTORY: ToneStrategy(prompt_desc=HISTORY_PROMPT_DESC),
    Tone.TECH: ToneStrategy(prompt_desc=TECH_PROMPT_DESC),
    Tone.HEALTH: ToneStrategy(prompt_desc=HEALTH_PROMPT_DESC),
}


def _window_items(
    items: List[Tuple[float, float, str]],
    window: float = WINDOW_SIZE_SECONDS,
    overlap: float = WINDOW_OVERLAP_SECONDS,
) -> List[Tuple[float, float, List[Tuple[float, float, str]]]]:
    """Return sliding windows across transcript items."""
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


def find_candidates_by_tone(
    transcript_path: str | Path,
    *,
    tone: Tone,
    min_rating: float | None = None,
    min_words: int | None = None,
    return_all_stages: bool = False,
    segments: Any | None = None,
    dialog_ranges: Any | None = None,
    silences: Any | None = None,
    **_: Any,
) -> List[ClipCandidate] | tuple[List[ClipCandidate], List[ClipCandidate], List[ClipCandidate]]:
    """Generic windowed candidate finder parameterized by ``Tone``."""

    from . import local_llm_call_json

    strategy = STRATEGY_REGISTRY[tone]
    min_rating = strategy.min_rating if min_rating is None else min_rating
    min_words = strategy.min_words if min_words is None else min_words

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
        prompt = build_window_prompt(strategy.prompt_desc, text)
        print(f"[Tone] window {win_start:.2f}-{win_end:.2f}")
        start_t = time.perf_counter()
        try:
            arr = local_llm_call_json(
                model=LOCAL_LLM_MODEL, prompt=prompt, options={"temperature": 0.2}
            )
        except Exception as e:
            print(f"[Tone] window {win_start:.2f}-{win_end:.2f} failed: {e}")
            continue
        elapsed = time.perf_counter() - start_t
        print(
            f"[Tone] LLM {win_start:.2f}-{win_end:.2f} took {elapsed:.2f}s and returned {len(arr)} candidates"
        )
        for it in arr:
            start_val = _to_float(_get_field(it, "start"))
            end_val = _to_float(_get_field(it, "end"))
            rating = _to_float(_get_field(it, "rating"))
            reason = str(_get_field(it, "reason", ""))
            quote = str(_get_field(it, "quote", ""))
            if start_val is None or end_val is None or rating is None:
                continue
            start_val = float(start_val)
            end_val = float(end_val)
            rating = round(float(rating), 1)
            if segments is not None and strategy.snap_to_sentence:
                new_start = _snap_start_to_sentence_start(start_val, segments)
                new_end = _snap_end_to_sentence_end(end_val, segments)
                if new_start != start_val or new_end != end_val:
                    print(
                        f"[Snap] sentence ({start_val:.2f}-{end_val:.2f}) -> ({new_start:.2f}-{new_end:.2f})"
                    )
                start_val, end_val = new_start, new_end
            if dialog_ranges is not None and strategy.snap_to_dialog:
                new_start = snap_start_to_dialog_start(start_val, dialog_ranges)
                new_end = snap_end_to_dialog_end(end_val, dialog_ranges)
                if new_start != start_val or new_end != end_val:
                    print(
                        f"[Snap] dialog ({start_val:.2f}-{end_val:.2f}) -> ({new_start:.2f}-{new_end:.2f})"
                    )
                start_val, end_val = new_start, new_end
            if silences is not None and strategy.snap_to_silence:
                new_start = snap_start_to_silence(start_val, silences)
                new_end = snap_end_to_silence(end_val, silences)
                if new_start != start_val or new_end != end_val:
                    print(
                        f"[Snap] silence ({start_val:.2f}-{end_val:.2f}) -> ({new_start:.2f}-{new_end:.2f})"
                    )
                start_val, end_val = new_start, new_end
            all_candidates.append(
                ClipCandidate(start=start_val, end=end_val, rating=rating, reason=reason, quote=quote)
            )

    filtered = [c for c in all_candidates if c.rating >= min_rating]
    filtered = _filter_promotional_candidates(filtered, items)
    print(f"[Tone] {len(filtered)} candidates >= {min_rating}")

    merged = _merge_adjacent_candidates(filtered, items, silences=silences)
    print(f"[Tone] {len(merged)} candidates after merge")

    top = _enforce_non_overlap(
        merged,
        items,
        silences=silences,
        min_duration_seconds=MIN_DURATION_SECONDS,
        min_rating=min_rating,
    )
    print(f"[Tone] {len(top)} candidates after non-overlap")
    if return_all_stages:
        return top, merged, all_candidates
    return top


__all__ = ["STRATEGY_REGISTRY", "find_candidates_by_tone"]

