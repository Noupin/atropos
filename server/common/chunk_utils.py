from __future__ import annotations

from typing import List, Tuple

_END_PUNCT = {".", "!", "?"}


def chunk_by_chars(
    items: List[Tuple[float, float, str]],
    *,
    max_chars: int,
    overlap_lines: int = 2,
    max_items: int | None = None,
) -> List[List[Tuple[float, float, str]]]:
    """Chunk transcript items under ``max_chars`` and ``max_items`` with small overlaps."""
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


def chunk_is_sentence_like(chunk: List[Tuple[float, float, str]]) -> bool:
    """Return ``True`` if the chunk already looks like sentence-bounded text."""
    if not chunk:
        return True
    ends_ok = sum(1 for _, _, t in chunk if t and t.strip()[-1:] in _END_PUNCT)
    ratio = ends_ok / max(1, len(chunk))
    avg_len = sum(len(t) for _, _, t in chunk) / max(1, len(chunk))
    return ratio >= 0.7 and 24 <= avg_len <= 240


__all__ = ["chunk_by_chars", "chunk_is_sentence_like"]
