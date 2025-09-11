from __future__ import annotations

import time
from pathlib import Path
from typing import Any, List, Tuple
from datetime import datetime

from config import (
    WINDOW_CONTEXT_PERCENTAGE,
    WINDOW_OVERLAP_SECONDS,
    WINDOW_SIZE_SECONDS,
    MIN_DURATION_SECONDS,
    LOCAL_LLM_MODEL,
)

from custom_types.tone import ToneStrategy
from custom_types.ETone import Tone

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
    FUNNY_RATING_DESCRIPTIONS,
    SPACE_RATING_DESCRIPTIONS,
    HISTORY_RATING_DESCRIPTIONS,
    TECH_RATING_DESCRIPTIONS,
    HEALTH_RATING_DESCRIPTIONS,
    build_window_prompt,
)

_TOTAL_LLM_SECONDS = 0.0

def _log(msg: str) -> None:
    print(msg)


STRATEGY_REGISTRY: dict[Tone, ToneStrategy] = {
    Tone.FUNNY: ToneStrategy(
        prompt_desc=FUNNY_PROMPT_DESC,
        rating_descriptions=FUNNY_RATING_DESCRIPTIONS,
    ),
    Tone.SPACE: ToneStrategy(
        prompt_desc=SPACE_PROMPT_DESC,
        rating_descriptions=SPACE_RATING_DESCRIPTIONS,
    ),
    Tone.HISTORY: ToneStrategy(
        prompt_desc=HISTORY_PROMPT_DESC,
        rating_descriptions=HISTORY_RATING_DESCRIPTIONS,
    ),
    Tone.TECH: ToneStrategy(
        prompt_desc=TECH_PROMPT_DESC,
        rating_descriptions=TECH_RATING_DESCRIPTIONS,
    ),
    Tone.HEALTH: ToneStrategy(
        prompt_desc=HEALTH_PROMPT_DESC,
        rating_descriptions=HEALTH_RATING_DESCRIPTIONS,
    ),
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

    _log(
        f"Run started {datetime.utcnow().isoformat()}Z | tone={tone.name} | windows={len(windows)} | min_rating={min_rating}"
    )

    all_candidates: List[ClipCandidate] = []
    context = WINDOW_SIZE_SECONDS * WINDOW_CONTEXT_PERCENTAGE

    global _TOTAL_LLM_SECONDS
    for win_start, win_end, win_items in windows:
        ctx_items = [
            it
            for it in items
            if it[1] > win_start - context and it[0] < win_end + context
        ]
        text = "\n".join(f"[{s:.2f}-{e:.2f}] {t}" for s, e, t in ctx_items)
        prompt = build_window_prompt(
            strategy.prompt_desc,
            text,
            strategy.rating_descriptions,
        )
        start_t = time.perf_counter()
        try:
            arr = local_llm_call_json(
                model=LOCAL_LLM_MODEL, prompt=prompt, options={"temperature": 0.2}
            )
        except Exception as e:
            continue
        elapsed = time.perf_counter() - start_t
        _TOTAL_LLM_SECONDS += elapsed
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
            model_start = start_val
            model_end = end_val
            if segments is not None and strategy.snap_to_sentence:
                new_start = _snap_start_to_sentence_start(start_val, segments)
                new_end = _snap_end_to_sentence_end(end_val, segments)
                start_val, end_val = new_start, new_end
            if dialog_ranges is not None and strategy.snap_to_dialog:
                new_start = snap_start_to_dialog_start(start_val, dialog_ranges)
                new_end = snap_end_to_dialog_end(end_val, dialog_ranges)
                start_val, end_val = new_start, new_end
            if silences is not None and strategy.snap_to_silence:
                new_start = snap_start_to_silence(start_val, silences)
                new_end = snap_end_to_silence(end_val, silences)
                start_val, end_val = new_start, new_end
            # Store a lightweight record to recover original model times if this clip is ultimately selected
            # We match later on the snapped (post-snap) times with small tolerance.
            if 'pre_snap_records' not in locals():
                pre_snap_records = []
            pre_snap_records.append({
                'snapped_start': start_val,
                'snapped_end': end_val,
                'model_start': model_start,
                'model_end': model_end,
                'rating': rating,
            })
            all_candidates.append(
                ClipCandidate(start=start_val, end=end_val, rating=rating, reason=reason, quote=quote)
            )

    filtered = [c for c in all_candidates if c.rating >= min_rating]
    filtered = _filter_promotional_candidates(filtered, items)
    merged = _merge_adjacent_candidates(filtered, items, silences=silences)
    final = _enforce_non_overlap(
        merged,
        items,
        silences=silences,
        min_duration_seconds=MIN_DURATION_SECONDS,
        min_rating=min_rating,
    )

    # Print only the final selections: original (model) timestamps if matchable, snapped timestamps, and rating
    def _find_orig(st: float, en: float, tol: float = 0.05):
        try:
            for rec in pre_snap_records:
                if abs(rec['snapped_start'] - st) <= tol and abs(rec['snapped_end'] - en) <= tol:
                    return rec['model_start'], rec['model_end']
        except NameError:
            pass
        return None, None

    for c in final:
        o_s, o_e = _find_orig(c.start, c.end)
        if o_s is not None and o_e is not None:
            _log(
                f"Picked clip | original_model={o_s:.2f}-{o_e:.2f} | snapped={c.start:.2f}-{c.end:.2f} | rating={c.rating:.1f}"
            )
        else:
            _log(
                f"Picked clip | snapped={c.start:.2f}-{c.end:.2f} | rating={c.rating:.1f}"
            )

    _log(
        f"Run summary | tone={tone.name} | all_candidates={len(all_candidates)} | rated_ge_min={len(filtered)} | merged={len(merged)} | top={len(filtered)} | total_llm_seconds={_TOTAL_LLM_SECONDS:.2f}"
    )

    if return_all_stages:
        return final, filtered, all_candidates
    return final


__all__ = ["STRATEGY_REGISTRY", "find_candidates_by_tone"]
