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
FACEBOOK_TOTAL_VIEWS_RE = re.compile(
    r"([0-9][0-9.,\u00a0]*\s*[KMB]?)\s+(?:total\s+)?views",
    re.IGNORECASE,
)


def _log_attempt(
    context: PlatformContext,
    handle: str,
    attempt: str,
    status: Optional[int],
    followers: Optional[int],
    views: Optional[int],
    source: str,
) -> None:
    context.logger.info(
        "facebook handle=%s attempt=%s status=%s followers=%s views=%s source=%s",
        handle,
        attempt,
        status if status is not None else "error",
        followers if followers is not None else "null",
        views if views is not None else "null",
        source,
    )


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
        _log_attempt(context, page_id, "api", None, None, None, "api:error")
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
        _log_attempt(context, page_id, "api", status, count, None, "api:fan_count")
        return AccountStats(
            handle=page_id,
            count=count,
            fetched_at=context.now(),
            source="api",
        )
    _log_attempt(context, page_id, "api", status, None, None, "api:missing")
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
        response = context.request(url, "facebook", handle, "direct")
        status = response.status_code if isinstance(response, Response) else None
        html = response.text if isinstance(response, Response) and response.ok else ""
        count, views, source = _parse_facebook_html(
            html, handle, "direct", url, context
        )
        _log_attempt(context, handle, "direct", status, count, views, source)
        if count is not None:
            extra = {"views": views} if isinstance(views, int) else None
            return AccountStats(
                handle=handle,
                count=count,
                fetched_at=context.now(),
                source=f"scrape:{source}",
                extra=extra,
            )
        proxy_html = context.fetch_text(url, "facebook", handle)
        count, views, source = _parse_facebook_html(
            proxy_html or "", handle, "text-proxy", url, context
        )
        _log_attempt(
            context,
            handle,
            "text-proxy",
            200 if proxy_html else None,
            count,
            views,
            source,
        )
        if count is not None:
            extra = {"views": views} if isinstance(views, int) else None
            return AccountStats(
                handle=handle,
                count=count,
                fetched_at=context.now(),
                source=f"scrape:{source}",
                extra=extra,
            )
    _log_attempt(context, handle, "scrape", None, None, None, "scrape:miss")
    return AccountStats(
        handle=handle,
        count=None,
        fetched_at=context.now(),
        source="scrape",
        error="Missing followers",
        is_mock=True,
    )


def _parse_facebook_html(
    html: str,
    handle: str,
    attempt: str,
    url: str,
    context: PlatformContext,
) -> Tuple[Optional[int], Optional[int], str]:
    if not html:
        context.logger.info(
            "facebook handle=%s attempt=%s url=%s parse=empty",
            handle,
            attempt,
            url,
        )
        return None, None, attempt
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
            views = _extract_views(html)
            return count, views, f"{attempt}:aria-label"

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

    views_capture: Optional[int] = None

    for candidate, label in text_variants:
        if views_capture is None:
            views_capture = _extract_views(candidate)
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
                return count, views_capture, f"{label}:follow-this"
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
                return count, views_capture, f"{label}:followers"
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
                return count, views_capture, f"{label}:follower"
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
                return count, views_capture, f"{label}:followers-after"

    match = FACEBOOK_JSON_RE.search(html)
    if match:
        count = int(match.group(1))
        context.logger.info(
            "facebook handle=%s attempt=%s parse=fan_count-json count=%s",
            handle,
            attempt,
            count,
        )
        views_capture = views_capture if views_capture is not None else _extract_views(html)
        return count, views_capture, f"{attempt}:fan_count"
    context.logger.info(
        "facebook handle=%s attempt=%s url=%s parse=miss",
        handle,
        attempt,
        url,
    )
    views_capture = views_capture if views_capture is not None else _extract_views(html)
    return None, views_capture, attempt


def _extract_views(text: str) -> Optional[int]:
    match = FACEBOOK_TOTAL_VIEWS_RE.search(text)
    if match:
        return parse_compact_number(match.group(1))
    return None
