from __future__ import annotations

"""Helpers for handling clip descriptions."""

from config import INCLUDE_WEBSITE_LINK, WEBSITE_URL


def maybe_append_website_link(text: str) -> str:
    """Append the website link to *text* when enabled via configuration.

    The link is only appended if ``INCLUDE_WEBSITE_LINK`` is ``True`` and the
    link is not already present in *text*.
    """
    if INCLUDE_WEBSITE_LINK and WEBSITE_URL and WEBSITE_URL not in text:
        if text and not text.endswith("\n"):
            text += "\n"
        text += WEBSITE_URL
    return text
