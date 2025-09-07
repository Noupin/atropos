from __future__ import annotations

from typing import Iterable, List, Sequence, Tuple


def format_transcript_lines(chunk: Sequence[Tuple[float, float, str]]) -> List[str]:
    """Format transcript triplets into ``"[start-end] text"`` lines."""
    return [f"[{s:.2f}-{e:.2f}] {t}" for s, e, t in chunk]


def default_llm_options(num_predict: int) -> dict:
    """Return standard LLM call options with configurable prediction length."""
    return {"temperature": 0.0, "top_p": 0.9, "num_predict": num_predict}


def chunk_span(chunk: Iterable[Tuple[float, float, str]]) -> Tuple[float, float]:
    """Return ``(min_start, max_end)`` for ``chunk``."""
    starts = [s for s, _, _ in chunk]
    ends = [e for _, e, _ in chunk]
    return (min(starts), max(ends)) if starts and ends else (0.0, 0.0)


def parse_llm_spans(out, *, with_text: bool = False):
    """Parse a list of span dicts from LLM output.

    Parameters
    ----------
    out:
        LLM JSON response, expected to be a list of objects with ``start`` and
        ``end`` keys, and optionally ``text`` when ``with_text`` is ``True``.
    with_text:
        Include the ``text`` field in returned tuples when ``True``.
    """
    spans = []
    if isinstance(out, list):
        for obj in out:
            try:
                s = float(obj.get("start"))
                e = float(obj.get("end"))
            except Exception:
                continue
            if e < s:
                continue
            if with_text:
                t = str(obj.get("text", "")).strip()
                if not t:
                    continue
                spans.append((s, e, t))
            else:
                spans.append((s, e))
    return spans


__all__ = [
    "format_transcript_lines",
    "default_llm_options",
    "chunk_span",
    "parse_llm_spans",
]
