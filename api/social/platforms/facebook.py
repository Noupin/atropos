from __future__ import annotations

import os
import re
from dataclasses import dataclass
from html import unescape
from typing import List, Optional, Tuple

from requests import RequestException, Response

from ..context import PlatformContext
from ..models import AccountStats
from ..settings import SCRAPER_TIMEOUT_SECONDS
from ..utils import log_scrape_attempt, parse_compact_number

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
FACEBOOK_VIEWS_RE = re.compile(
    r"([0-9][0-9.,\u00a0]*\s*[KMB]?)\s+(?:total\s+)?views",
    re.IGNORECASE,
)


@dataclass
class FacebookParseResult:
    count: Optional[int]
    views: Optional[int]
    detail: str
    success: bool


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
    views_snapshot: Optional[int] = None
    for url in urls:
        response = context.request(url, "facebook", handle, "direct")
        html = response.text if isinstance(response, Response) and response.ok else ""
        direct_result = _parse_facebook_html(html)
        if isinstance(direct_result.views, int) and views_snapshot is None:
            views_snapshot = direct_result.views
        log_scrape_attempt(
            context.logger,
            "facebook",
            handle,
            "direct",
            direct_result.detail,
            direct_result.count,
            direct_result.views,
            direct_result.success,
        )
        if direct_result.count is not None:
            view_value = (
                direct_result.views
                if isinstance(direct_result.views, int)
                else views_snapshot
            )
            extra = {"views": view_value} if isinstance(view_value, int) else None
            return AccountStats(
                handle=handle,
                count=direct_result.count,
                fetched_at=context.now(),
                source=f"scrape:direct:{direct_result.detail}",
                extra=extra,
            )
        proxy_html = context.fetch_text(url, "facebook", handle)
        proxy_result = _parse_facebook_html(proxy_html or "")
        if isinstance(proxy_result.views, int) and views_snapshot is None:
            views_snapshot = proxy_result.views
        log_scrape_attempt(
            context.logger,
            "facebook",
            handle,
            "text-proxy",
            proxy_result.detail,
            proxy_result.count,
            proxy_result.views,
            proxy_result.success,
        )
        if proxy_result.count is not None:
            view_value = (
                proxy_result.views
                if isinstance(proxy_result.views, int)
                else views_snapshot
            )
            extra = {"views": view_value} if isinstance(view_value, int) else None
            return AccountStats(
                handle=handle,
                count=proxy_result.count,
                fetched_at=context.now(),
                source=f"scrape:text-proxy:{proxy_result.detail}",
                extra=extra,
            )
    return AccountStats(
        handle=handle,
        count=None,
        fetched_at=context.now(),
        source="scrape",
        error="Missing followers",
    )



def _parse_facebook_html(html: str) -> FacebookParseResult:
    if not html:
        return FacebookParseResult(None, None, "empty", False)

    text_variants: List[Tuple[str, str]] = [(html, "html")]
    if "<" in html:
        stripped = re.sub(r"<[^>]+>", " ", html)
        normalized = re.sub(r"\s+", " ", unescape(stripped)).strip()
        if normalized:
            text_variants.append((normalized, "html-text"))

    markdown = re.sub(r"\[(.*?)\]\((.*?)\)", r"\1", html)
    markdown = re.sub(r"[\[\]*_`]", "", markdown)
    markdown = markdown.replace("•", " ")
    markdown = re.sub(r"\s+", " ", unescape(markdown)).strip()
    if markdown and markdown != html:
        text_variants.append((markdown, "markdown"))

    views = _extract_facebook_views([candidate for candidate, _ in text_variants])

    aria_match = FACEBOOK_ARIA_LABEL_RE.search(html)
    if aria_match:
        count = _parse_facebook_number(aria_match.group(1))
        if count is not None:
            return FacebookParseResult(count, views, "aria-label", True)

    json_match = FACEBOOK_JSON_RE.search(html)
    if json_match and json_match.group(1).isdigit():
        count = int(json_match.group(1))
        return FacebookParseResult(count, views, "json-fan_count", True)

    follower_patterns: List[Tuple[re.Pattern[str], str]] = [
        (FACEBOOK_FOLLOW_RE, "follow-this"),
        (FACEBOOK_FOLLOWERS_RE, "followers"),
        (FACEBOOK_FOLLOWER_RE, "follower"),
        (FACEBOOK_FOLLOWERS_AFTER_RE, "followers-after"),
    ]

    for candidate, label in text_variants:
        for pattern, pattern_label in follower_patterns:
            match = pattern.search(candidate)
            if match:
                count = _parse_facebook_number(match.group(1))
                if count is not None:
                    detail = f"{label}:{pattern_label}"
                    return FacebookParseResult(count, views, detail, True)

    detail = "views-only" if isinstance(views, int) else "miss"
    return FacebookParseResult(None, views, detail, False)


def _extract_facebook_views(variants: List[str]) -> Optional[int]:
    for candidate in variants:
        match = FACEBOOK_VIEWS_RE.search(candidate)
        if match:
            value = _parse_facebook_number(match.group(1))
            if value is not None:
                return value
    return None


def _parse_facebook_number(token: str) -> Optional[int]:
    if not token:
        return None
    if re.search(r"[KMB]", token, re.IGNORECASE):
        return parse_compact_number(token)
    digits = re.sub(r"[^0-9]", "", token)
    if digits:
        return int(digits)
    return parse_compact_number(token)
