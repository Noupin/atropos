from __future__ import annotations

import os
import re
from html import unescape
from typing import List, Optional, Tuple

from requests import RequestException, Response

from ..context import PlatformContext
from ..models import AccountStats
from ..settings import SCRAPER_TIMEOUT_SECONDS
from ..utils import parse_compact_number

FACEBOOK_FOLLOW_RE = re.compile(
    r"([0-9][0-9.,\u00a0]*\s*[KMB]?)\s+(?:people\s+)?follow this",
    re.IGNORECASE,
)
FACEBOOK_FOLLOWERS_RE = re.compile(
    r"([0-9][0-9.,\u00a0]*\s*[KMB]?)\s+followers",
    re.IGNORECASE,
)
FACEBOOK_FOLLOWER_RE = re.compile(
    r"([0-9][0-9.,\u00a0]*\s*[KMB]?)\s+follower\b",
    re.IGNORECASE,
)
FACEBOOK_FOLLOWERS_AFTER_RE = re.compile(
    r"followers?\s*(?:[:=]|are|is)?\s*(?:[•\u2022·:\-–—])?\s*([0-9][0-9.,\u00a0]*\s*[KMB]?)",
    re.IGNORECASE,
)
FACEBOOK_ARIA_LABEL_RE = re.compile(
    r'aria-label=["\']([0-9][0-9.,\u00a0]*\s*[KMB]?)\s+followers["\']',
    re.IGNORECASE,
)
FACEBOOK_JSON_RE = re.compile(r'"fan_count"\s*:\s*([0-9]+)')


def resolve(handle: str, context: PlatformContext) -> AccountStats:
    access_token = os.environ.get("SOCIAL_FACEBOOK_ACCESS_TOKEN")
    page_id = os.environ.get("SOCIAL_FACEBOOK_PAGE_ID")
    if access_token and page_id and handle == page_id:
        api_result = _fetch_facebook_api(page_id, access_token, context)
        if api_result.count is not None:
            return api_result
    return _fetch_facebook_scrape(handle, context)


def _fetch_facebook_api(
    page_id: str, access_token: str, context: PlatformContext
) -> AccountStats:
    url = f"https://graph.facebook.com/v17.0/{page_id}"
    params = {"fields": "fan_count", "access_token": access_token}
    try:
        response = context.session.get(
            url, params=params, timeout=SCRAPER_TIMEOUT_SECONDS
        )
        status = response.status_code
        context.logger.info(
            "facebook handle=%s attempt=api url=%s status=%s",
            page_id,
            response.url,
            status,
        )
        if not response.ok:
            return AccountStats(
                handle=page_id,
                count=None,
                fetched_at=context.now(),
                source="api",
                error=f"HTTP {status}",
            )
        payload = response.json()
    except (RequestException, ValueError) as exc:
        context.logger.info("facebook handle=%s attempt=api error=%s", page_id, exc)
        return AccountStats(
            handle=page_id,
            count=None,
            fetched_at=context.now(),
            source="api",
            error=str(exc),
        )
    count = payload.get("fan_count")
    if isinstance(count, int):
        context.logger.info(
            "facebook handle=%s attempt=api parse=fan_count count=%s",
            page_id,
            count,
        )
        return AccountStats(
            handle=page_id,
            count=count,
            fetched_at=context.now(),
            source="api",
        )
    return AccountStats(
        handle=page_id,
        count=None,
        fetched_at=context.now(),
        source="api",
        error="Missing fan_count",
    )


def _fetch_facebook_scrape(handle: str, context: PlatformContext) -> AccountStats:
    slug = handle.lstrip("@")

    def build_urls(path: str) -> List[str]:
        local_urls: List[str] = []
        seen_local: set[str] = set()

        def add(url: str) -> None:
            if url not in seen_local:
                seen_local.add(url)
                local_urls.append(url)

        if path.startswith("http://") or path.startswith("https://"):
            add(path)
            return local_urls

        add(f"https://mbasic.facebook.com/{path}")

        info_suffix = "&v=info" if "?" in path else "?v=info"
        info_path = f"{path}{info_suffix}"
        if info_path != path:
            add(f"https://mbasic.facebook.com/{info_path}")

        add(f"https://www.facebook.com/{path}")
        return local_urls

    urls: List[str] = []
    seen_urls: set[str] = set()

    def extend_urls(path: str) -> None:
        for candidate in build_urls(path):
            if candidate not in seen_urls:
                seen_urls.add(candidate)
                urls.append(candidate)

    extend_urls(slug)

    if slug.isdigit():
        extend_urls(f"profile.php?id={slug}")
    elif slug.startswith("profile.php?id="):
        extend_urls(slug)
    for url in urls:
        response = context.request(url, "facebook", handle, "direct", None)
        html = response.text if isinstance(response, Response) and response.ok else ""
        count, source = _parse_facebook_html(html, handle, "direct", url, context)
        if count is not None:
            return AccountStats(
                handle=handle,
                count=count,
                fetched_at=context.now(),
                source=f"scrape:{source}",
            )
        proxy_html = context.fetch_text(url, "facebook", handle)
        count, source = _parse_facebook_html(
            proxy_html or "", handle, "text-proxy", url, context
        )
        if count is not None:
            return AccountStats(
                handle=handle,
                count=count,
                fetched_at=context.now(),
                source=f"scrape:{source}",
            )
    return AccountStats(
        handle=handle,
        count=None,
        fetched_at=context.now(),
        source="scrape",
        error="Missing followers",
    )


def _parse_facebook_html(
    html: str,
    handle: str,
    attempt: str,
    url: str,
    context: PlatformContext,
) -> Tuple[Optional[int], str]:
    if not html:
        context.logger.info(
            "facebook handle=%s attempt=%s url=%s parse=empty",
            handle,
            attempt,
            url,
        )
        return None, attempt
    aria_match = FACEBOOK_ARIA_LABEL_RE.search(html)
    if aria_match:
        count = parse_compact_number(aria_match.group(1))
        if count is not None:
            context.logger.info(
                "facebook handle=%s attempt=%s parse=aria-label count=%s",
                handle,
                attempt,
                count,
            )
            return count, f"{attempt}:aria-label"

    text_variants: List[Tuple[str, str]] = [(html, attempt)]
    if "<" in html:
        stripped = re.sub(r"<[^>]+>", " ", html)
        normalized = re.sub(r"\s+", " ", unescape(stripped)).strip()
        if normalized:
            text_variants.append((normalized, f"{attempt}-text"))

    markdown = re.sub(r"\[(.*?)\]\((.*?)\)", r"\1", html)
    markdown = re.sub(r"[\[\]*_`]", "", markdown)
    markdown = markdown.replace("•", " ")
    markdown = re.sub(r"\s+", " ", unescape(markdown)).strip()
    if markdown and markdown != html:
        text_variants.append((markdown, f"{attempt}-markdown"))

    for candidate, label in text_variants:
        match = FACEBOOK_FOLLOW_RE.search(candidate)
        if match:
            count = parse_compact_number(match.group(1))
            if count is not None:
                context.logger.info(
                    "facebook handle=%s attempt=%s parse=follow-this count=%s",
                    handle,
                    label,
                    count,
                )
                return count, f"{label}:follow-this"
        match = FACEBOOK_FOLLOWERS_RE.search(candidate)
        if match:
            count = parse_compact_number(match.group(1))
            if count is not None:
                context.logger.info(
                    "facebook handle=%s attempt=%s parse=followers count=%s",
                    handle,
                    label,
                    count,
                )
                return count, f"{label}:followers"
        match = FACEBOOK_FOLLOWER_RE.search(candidate)
        if match:
            count = parse_compact_number(match.group(1))
            if count is not None:
                context.logger.info(
                    "facebook handle=%s attempt=%s parse=follower count=%s",
                    handle,
                    label,
                    count,
                )
                return count, f"{label}:follower"
        match = FACEBOOK_FOLLOWERS_AFTER_RE.search(candidate)
        if match:
            count = parse_compact_number(match.group(1))
            if count is not None:
                context.logger.info(
                    "facebook handle=%s attempt=%s parse=followers-after count=%s",
                    handle,
                    label,
                    count,
                )
                return count, f"{label}:followers-after"

    match = FACEBOOK_JSON_RE.search(html)
    if match:
        count = int(match.group(1))
        context.logger.info(
            "facebook handle=%s attempt=%s parse=fan_count-json count=%s",
            handle,
            attempt,
            count,
        )
        return count, f"{attempt}:fan_count"
    context.logger.info(
        "facebook handle=%s attempt=%s url=%s parse=miss",
        handle,
        attempt,
        url,
    )
    return None, attempt
