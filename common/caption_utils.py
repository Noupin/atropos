"""Helpers for caption normalisation and hashtag handling."""

from __future__ import annotations

import re
from typing import Iterable, List


HASHTAG_RE = re.compile(r"#\w+")


def collapse_whitespace(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def extract_hashtags(text: str) -> List[str]:
    return HASHTAG_RE.findall(text)


def keep_top_hashtags(tags: Iterable[str], top_n: int) -> List[str]:
    seen: List[str] = []
    for tag in tags:
        if tag not in seen:
            seen.append(tag)
        if len(seen) >= top_n:
            break
    return seen


def append_default_tags(tags: List[str], defaults: Iterable[str]) -> List[str]:
    for tag in defaults:
        if tag not in tags:
            tags.append(tag)
    return tags


def truncate_word_boundary(text: str, limit: int) -> str:
    if len(text) <= limit:
        return text
    truncated = text[:limit]
    if " " in truncated:
        truncated = truncated.rsplit(" ", 1)[0]
    return truncated


def normalize_caption(
    text: str,
    limit: int,
    top_n: int,
    defaults: Iterable[str],
) -> str:
    """Normalise caption text according to platform rules."""

    base = collapse_whitespace(text)
    tags = extract_hashtags(base)
    tags = keep_top_hashtags(tags, top_n)
    tags = append_default_tags(tags, defaults)
    base_no_tags = HASHTAG_RE.sub("", base).strip()
    caption = (base_no_tags + " " + " ".join(tags)).strip()
    return truncate_word_boundary(caption, limit)


__all__ = [
    "normalize_caption",
    "collapse_whitespace",
    "extract_hashtags",
    "keep_top_hashtags",
    "append_default_tags",
    "truncate_word_boundary",
]

