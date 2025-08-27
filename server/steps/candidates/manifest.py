from __future__ import annotations

from pathlib import Path
from typing import List
import json

from server.interfaces.clip_candidate import ClipCandidate


__all__ = [
    "_get_field",
    "_to_float",
    "export_candidates_json",
    "load_candidates_json",
]


def _get_field(obj, key, default=None):
    """Return ``obj[key]`` if dict-like, ``getattr(obj, key)`` if attribute-like, else ``default``."""
    if isinstance(obj, dict):
        return obj.get(key, default)
    return getattr(obj, key, default)


def _to_float(val):
    try:
        return float(val)
    except Exception:
        return None


def export_candidates_json(candidates: List[ClipCandidate], path: str | Path) -> None:
    out = Path(path)
    out.parent.mkdir(parents=True, exist_ok=True)
    payload = [
        {
            "start": c.start,
            "end": c.end,
            "rating": c.rating,
            "reason": c.reason,
            "quote": c.quote,
        }
        for c in candidates
    ]
    out.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def load_candidates_json(path: str | Path) -> List[ClipCandidate]:
    p = Path(path)
    data = json.loads(p.read_text(encoding="utf-8"))
    result: List[ClipCandidate] = []
    for it in data:
        start = _to_float(_get_field(it, "start"))
        end = _to_float(_get_field(it, "end"))
        rating = _to_float(_get_field(it, "rating"))
        reason = str(_get_field(it, "reason", ""))
        quote = str(_get_field(it, "quote", ""))
        if start is None or end is None or rating is None:
            continue
        result.append(
            ClipCandidate(start=start, end=end, rating=rating, reason=reason, quote=quote)
        )
    return result
