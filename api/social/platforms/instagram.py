from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass, replace
from html import unescape
from typing import List, Optional, Tuple

from requests import RequestException, Response

from ..context import PlatformContext
from ..models import AccountStats
from ..settings import SCRAPER_TIMEOUT_SECONDS
from ..utils import log_scrape_attempt, parse_compact_number
INSTAGRAM_NEXT_DATA_RE = re.compile(
    r"<script[^>]+id=\"__NEXT_DATA__\"[^>]*>(\{.*?\})</script>",
    re.DOTALL | re.IGNORECASE,
)
INSTAGRAM_FOLLOWERS_RE = re.compile(
    r"([0-9][0-9.,\u00a0]*\s*[KMB]?)\s+followers",
    re.IGNORECASE,
)


@dataclass
class InstagramParseResult:
    count: Optional[int]
    posts: Optional[int]
    detail: str
    success: bool


def resolve(handle: str, context: PlatformContext) -> AccountStats:
    scrape_result = _fetch_instagram_scrape(handle, context)

    if scrape_result.count is not None:
        return scrape_result

    access_token = os.environ.get("SOCIAL_INSTAGRAM_ACCESS_TOKEN")
    user_id = os.environ.get("SOCIAL_INSTAGRAM_USER_ID")
    if not (access_token and user_id):
        return scrape_result

    api_result = _fetch_instagram_api(user_id, access_token, handle, context)
    if scrape_result.extra and not api_result.extra:
        api_result = replace(api_result, extra=scrape_result.extra)
    if api_result.count is not None:
        return api_result
    return scrape_result


def _fetch_instagram_api(
    user_id: str, access_token: str, handle: str, context: PlatformContext
) -> AccountStats:
    url = f"https://graph.facebook.com/v17.0/{user_id}"
    params = {"fields": "followers_count", "access_token": access_token}
    try:
        response = context.session.get(
            url, params=params, timeout=SCRAPER_TIMEOUT_SECONDS
        )
        status = response.status_code
        context.logger.info(
            "instagram handle=%s attempt=api url=%s status=%s",
            handle,
            response.url,
            status,
        )
        if not response.ok:
            return AccountStats(
                handle=handle,
                count=None,
                fetched_at=context.now(),
                source="api",
                error=f"HTTP {status}",
            )
        payload = response.json()
    except (RequestException, ValueError) as exc:
        context.logger.info("instagram handle=%s attempt=api error=%s", handle, exc)
        return AccountStats(
            handle=handle,
            count=None,
            fetched_at=context.now(),
            source="api",
            error=str(exc),
        )
    count = payload.get("followers_count")
    if isinstance(count, int):
        context.logger.info(
            "instagram handle=%s attempt=api parse=followers_count count=%s",
            handle,
            count,
        )
        return AccountStats(
            handle=handle,
            count=count,
            fetched_at=context.now(),
            source="api",
        )
    return AccountStats(
        handle=handle,
        count=None,
        fetched_at=context.now(),
        source="api",
        error="Missing followers_count",
    )


def _fetch_instagram_scrape(handle: str, context: PlatformContext) -> AccountStats:
    slug = handle.lstrip("@")
    url = f"https://www.instagram.com/{slug}/"
    posts_snapshot: Optional[int] = None

    for source in ("direct", "text-proxy"):
        if source == "direct":
            response = context.request(url, "instagram", handle, source)
            html = response.text if isinstance(response, Response) and response.ok else ""
        else:
            html = context.fetch_text(url, "instagram", handle) or ""
        result = _parse_instagram_html(html)
        if result.posts is not None and posts_snapshot is None:
            posts_snapshot = result.posts
        log_scrape_attempt(
            context.logger,
            "instagram",
            handle,
            source,
            result.detail,
            result.count,
            None,
            result.success,
        )
        if result.count is not None:
            extra = {}
            if result.posts is not None:
                extra["posts"] = result.posts
            elif posts_snapshot is not None:
                extra["posts"] = posts_snapshot
            return AccountStats(
                handle=handle,
                count=result.count,
                fetched_at=context.now(),
                source=f"scrape:{source}:{result.detail}",
                extra=extra or None,
            )

    extra = {}
    if posts_snapshot is not None:
        extra["posts"] = posts_snapshot
    return AccountStats(
        handle=handle,
        count=None,
        fetched_at=context.now(),
        source="scrape",
        error="Missing followers",
        extra=extra or None,
    )


def _parse_instagram_html(html: str) -> InstagramParseResult:
    if not html:
        return InstagramParseResult(None, None, "empty", False)

    data = _extract_next_data(html)
    posts = None
    details: List[str] = []
    if data is not None:
        count, posts, data_detail = _extract_counts_from_data(data)
        if count is not None:
            return InstagramParseResult(
                count,
                posts,
                f"next-data:{data_detail}",
                True,
            )
        details.append(f"next-data:{data_detail}")
    else:
        details.append("next-data-missing")

    fallback_count, fallback_detail = _parse_followers_regex(html)
    details.append(fallback_detail)
    if fallback_count is not None:
        return InstagramParseResult(
            fallback_count,
            posts,
            fallback_detail,
            True,
        )

    detail = "|".join(details)
    return InstagramParseResult(None, posts, detail or "miss", False)


def _extract_next_data(html: str) -> Optional[dict]:
    match = INSTAGRAM_NEXT_DATA_RE.search(html)
    if not match:
        return None
    try:
        return json.loads(match.group(1))
    except json.JSONDecodeError:
        return None


def _extract_counts_from_data(data: dict) -> Tuple[Optional[int], Optional[int], str]:
    count: Optional[int] = None
    posts: Optional[int] = None
    detail = "miss"

    def visit(node: object) -> None:
        nonlocal count, posts, detail
        if isinstance(node, dict):
            if count is None:
                edge_followed_by = node.get("edge_followed_by")
                if isinstance(edge_followed_by, dict):
                    value = edge_followed_by.get("count")
                    if isinstance(value, int):
                        count = value
                        detail = "edge_followed_by"
            if count is None:
                follower_count = node.get("follower_count")
                if isinstance(follower_count, int):
                    count = follower_count
                    detail = "follower_count"
            if posts is None:
                media = node.get("edge_owner_to_timeline_media")
                if isinstance(media, dict):
                    media_count = media.get("count")
                    if isinstance(media_count, int):
                        posts = media_count
            if posts is None:
                media_count_value = node.get("media_count")
                if isinstance(media_count_value, int):
                    posts = media_count_value
            if count is not None and posts is not None:
                return
            for value in node.values():
                if count is not None and posts is not None:
                    break
                visit(value)
        elif isinstance(node, list):
            for item in node:
                if count is not None and posts is not None:
                    break
                visit(item)

    visit(data)
    return count, posts, detail


def _parse_followers_regex(html: str) -> Tuple[Optional[int], str]:
    normalized = _strip_html(html)
    if not normalized:
        return None, "regex-empty"
    match = INSTAGRAM_FOLLOWERS_RE.search(normalized)
    if match:
        count = _parse_followers_token(match.group(1))
        if count is not None:
            return count, "regex-followers"
    return None, "regex-miss"


def _strip_html(html: str) -> str:
    if not html:
        return ""
    stripped = re.sub(r"<[^>]+>", " ", html)
    return re.sub(r"\s+", " ", unescape(stripped)).strip()


def _parse_followers_token(token: str) -> Optional[int]:
    if not token:
        return None
    if re.search(r"[KMB]", token, re.IGNORECASE):
        return parse_compact_number(token)
    digits = re.sub(r"[^0-9]", "", token)
    if digits:
        return int(digits)
    return parse_compact_number(token)
