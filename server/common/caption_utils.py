"""Helpers for caption normalisation and hashtag handling."""

from __future__ import annotations

import re
from typing import Iterable, List


HASHTAG_RE = re.compile(r"#\w+")
HASHTAG_CLEAN_RE = re.compile(r"[^0-9A-Za-z]+")


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


def clean_hashtag(tag: str) -> str:
    """Remove whitespace and punctuation from a hashtag."""

    return HASHTAG_CLEAN_RE.sub("", tag)


def prepare_hashtags(tags: Iterable[str], show: str | None = None) -> List[str]:
    """Sanitise and sort hashtags, optionally including a show name."""

    cleaned: List[str] = []
    for tag in tags:
        if isinstance(tag, str):
            cleaned_tag = clean_hashtag(tag)
            if cleaned_tag:
                cleaned.append(cleaned_tag)
    if show:
        show_tag = clean_hashtag(show)
        if show_tag:
            cleaned.append(show_tag)
    deduped = list(dict.fromkeys(cleaned))
    deduped.sort(key=len)
    return [f"#{t}" for t in deduped]


def build_hashtag_prompt(
    title: str, quote: str | None = None, show: str | None = None
) -> str:
    """Create an instruction prompt for hashtag generation."""

    prompt = (
        "Generate as many relevant hashtags for a short form video based on the "
        "video's title"
    )
    if quote:
        prompt += " and a quote from the clip"
    prompt += (
        ". Favor short hashtags, avoid punctuation, and the title does not always "
        "need to be a hashtag. Include the show name if provided. Respond with a "
        "JSON array of strings without the # symbol.\n"
        f"Title: {title}\n"
    )
    if quote:
        prompt += f"Quote: {quote}\n"
    if show:
        prompt += f"Show: {show}\n"
    return prompt


__all__ = [
    "normalize_caption",
    "collapse_whitespace",
    "extract_hashtags",
    "keep_top_hashtags",
    "append_default_tags",
    "truncate_word_boundary",
    "clean_hashtag",
    "prepare_hashtags",
    "build_hashtag_prompt",
]

