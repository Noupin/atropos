"""Helpers for caption normalisation and hashtag handling."""

from __future__ import annotations

import re
from typing import Iterable, List


HASHTAG_RE = re.compile(r"#\w+")
HASHTAG_CLEAN_RE = re.compile(r"[^0-9A-Za-z]+")

# Remove emoji and other pictographic symbols that can break platform parsers or JSON contracts
EMOJI_RE = re.compile(
    r"[\U0001F600-\U0001F64F]"  # emoticons
    r"|[\U0001F300-\U0001F5FF]"  # symbols & pictographs
    r"|[\U0001F680-\U0001F6FF]"  # transport & map
    r"|[\U0001F700-\U0001F77F]"  # alchemical symbols
    r"|[\U0001F780-\U0001F7FF]"  # geometric shapes extended
    r"|[\U0001F800-\U0001F8FF]"  # supplemental arrows-C
    r"|[\U0001F900-\U0001F9FF]"  # supplemental symbols & pictographs
    r"|[\U0001FA00-\U0001FA6F]"  # chess symbols, symbols & pictographs ext-A
    r"|[\U0001FA70-\U0001FAFF]"  # symbols & pictographs ext-B
    r"|[\u2600-\u26FF]"          # misc symbols
    r"|[\u2700-\u27BF]"          # dingbats
)

PRINTABLE_ASCII_RE = re.compile(r"[^\x20-\x7E]\s*")

def remove_emoji(text: str) -> str:
    """Strip emoji and non‑printable characters to ensure UTF‑8 safe, description‑friendly text."""
    # First drop emoji/pictographs, then any remaining non‑printable ascii
    no_emoji = EMOJI_RE.sub("", text)
    return PRINTABLE_ASCII_RE.sub("", no_emoji)


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
    base = remove_emoji(base)
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
    title: str,
    quote: str | None = None,
    show: str | None = None,
    max_items: int = 15,
    max_tag_len: int = 24,
    max_total_chars: int = 200,
) -> str:
    """Create a strict instruction prompt for hashtag generation.

    Enforces:
    - Output MUST be a valid JSON array of strings, with no prose or keys.
    - No emojis or non‑ASCII; only lowercase a–z and digits 0–9.
    - No `#`, spaces, punctuation, or diacritics inside items.
    - No profanity or offensive language.
    - Size limits: at most `max_items` items; each string length ≤ `max_tag_len`;
      total characters across all items (including commas and quotes) ≤ `max_total_chars`.
    """

    base = (
        "Generate hashtags for a short‑form video using ONLY the fields below.\n"
        "Return EXACTLY one value: a valid JSON array of strings.\n"
        "Respond with plain text containing only the JSON array.\n"
        "Rules (must all be followed):\n"
        "1) Strict JSON: no preface, no trailing commas, no comments, no backticks, no Markdown.\n"
        "2) Items: only lowercase a-z and 0-9; no spaces, punctuation, diacritics, or emojis.\n"
        "3) Do NOT include the leading # in items.\n"
        f"4) Limits: at most {max_items} items; each ≤ {max_tag_len} characters; total output ≤ {max_total_chars} characters.\n"
        "5) Mix broad and specific terms relevant to the content; include the show name as one item if provided (sanitized).\n"
        "6) If a required item would violate the rules, omit it rather than breaking format.\n"
        "7) No profanity or offensive language.\n"
    )

    prompt = base + f"Title: {title}\n"
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
    "remove_emoji",
]
