from __future__ import annotations

import json
import os
import re
from dataclasses import replace
from typing import Iterable, Optional, Tuple

from requests import RequestException, Response

from ..context import PlatformContext
from ..models import AccountStats
from ..settings import SCRAPER_TIMEOUT_SECONDS
from ..utils import parse_compact_number

INSTAGRAM_NEXT_DATA_RE = re.compile(
    r"<script[^>]+id=\"__NEXT_DATA__\"[^>]*>(\{.*?\})</script>",
    re.DOTALL | re.IGNORECASE,
)
INSTAGRAM_LD_JSON_RE = re.compile(
    r"<script\s+type=\"application/ld\+json\">(\{.*?\})</script>",
    re.DOTALL | re.IGNORECASE,
)
INSTAGRAM_SHARED_DATA_RE = re.compile(
    r"window\._sharedData\s*=\s*(\{.*?\})\s*;",
    re.DOTALL | re.IGNORECASE,
)
INSTAGRAM_FOLLOWERS_RE = re.compile(
    r"([0-9][0-9.,\u00a0]*\s*[KMB]?)\s+followers",
    re.IGNORECASE,
)
INSTAGRAM_POSTS_RE = re.compile(
    r"([0-9][0-9.,\u00a0]*\s*[KMB]?)\s+posts",
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
        "instagram handle=%s attempt=%s status=%s followers=%s views=%s source=%s",
        handle,
        attempt,
        status if status is not None else "error",
        followers if followers is not None else "null",
        views if views is not None else "null",
        source,
    )


def resolve(handle: str, context: PlatformContext) -> AccountStats:
    access_token = os.environ.get("SOCIAL_INSTAGRAM_ACCESS_TOKEN")
    user_id = os.environ.get("SOCIAL_INSTAGRAM_USER_ID")
    api_result: Optional[AccountStats] = None
    if access_token and user_id:
        api_result = _fetch_instagram_api(user_id, access_token, handle, context)
        if api_result.count is not None and api_result.extra and api_result.extra.get("views") is not None:
            return api_result

    scrape_result = _fetch_instagram_scrape(handle, context)

    if scrape_result.count is not None:
        if api_result and api_result.count is not None:
            combined_extra = scrape_result.extra or api_result.extra
            if combined_extra and combined_extra != api_result.extra:
                return replace(api_result, extra=combined_extra)
            return api_result
        return scrape_result

    if api_result and api_result.count is not None:
        if scrape_result.extra and not api_result.extra:
            return replace(api_result, extra=scrape_result.extra)
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
            _log_attempt(context, handle, "api", status, None, None, "api:http-error")
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
        _log_attempt(context, handle, "api", None, None, None, "api:error")
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
        _log_attempt(context, handle, "api", status, count, None, "api:followers_count")
        return AccountStats(
            handle=handle,
            count=count,
            fetched_at=context.now(),
            source="api",
        )
    _log_attempt(context, handle, "api", status, None, None, "api:missing")
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
    views_snapshot: Optional[int] = None

    for attempt in ("direct", "text-proxy"):
        status: Optional[int]
        if attempt == "direct":
            response = context.request(url, "instagram", handle, attempt)
            status = response.status_code if isinstance(response, Response) else None
            html = response.text if isinstance(response, Response) and response.ok else ""
        else:
            html = context.fetch_text(url, "instagram", handle) or ""
            status = 200 if html else None
        count, posts, views, source = _parse_instagram_html(
            html, handle, attempt, url, context
        )
        if posts is not None and posts_snapshot is None:
            posts_snapshot = posts
        if views is not None and views_snapshot is None:
            views_snapshot = views
        _log_attempt(context, handle, attempt, status, count, views, source)
        if count is not None:
            extra: dict[str, int] = {}
            if posts is not None:
                extra["posts"] = posts
            elif posts_snapshot is not None:
                extra["posts"] = posts_snapshot
            if views is not None:
                extra["views"] = views
            elif views_snapshot is not None:
                extra["views"] = views_snapshot
            return AccountStats(
                handle=handle,
                count=count,
                fetched_at=context.now(),
                source=f"scrape:{source}",
                extra=extra or None,
            )
    return AccountStats(
        handle=handle,
        count=None,
        fetched_at=context.now(),
        source="scrape",
        error="Missing followers",
        is_mock=True,
        extra={"posts": posts_snapshot} if posts_snapshot is not None else None,
    )


def _parse_instagram_html(
    html: str,
    handle: str,
    attempt: str,
    url: str,
    context: PlatformContext,
) -> Tuple[Optional[int], Optional[int], Optional[int], str]:
    if not html:
        return None, None, None, f"{attempt}:empty"

    for pattern, label in (
        (INSTAGRAM_NEXT_DATA_RE, "next-data"),
        (INSTAGRAM_SHARED_DATA_RE, "shared-data"),
    ):
        match = pattern.search(html)
        if match:
            try:
                payload = json.loads(match.group(1))
            except json.JSONDecodeError:
                payload = None
            if isinstance(payload, dict):
                count, posts, views = _extract_from_structures([payload])
                if count is not None:
                    return count, posts, views, f"{attempt}:{label}"

    ld_match = INSTAGRAM_LD_JSON_RE.search(html)
    if ld_match:
        try:
            ld_data = json.loads(ld_match.group(1))
        except json.JSONDecodeError:
            ld_data = None
        if isinstance(ld_data, dict):
            count, posts, views = _extract_from_structures([ld_data])
            if count is not None:
                return count, posts, views, f"{attempt}:ld-json"

    for snippet in _extract_embedded_json(html):
        try:
            data = json.loads(snippet)
        except json.JSONDecodeError:
            continue
        count, posts, views = _extract_from_structures([data])
        if count is not None:
            return count, posts, views, f"{attempt}:json"

    normalized = _normalize_text(html)
    if normalized:
        count = _extract_first_number(normalized, INSTAGRAM_FOLLOWERS_RE)
        posts = _extract_first_number(normalized, INSTAGRAM_POSTS_RE)
        if count is not None:
            return count, posts, None, f"{attempt}:regex"

    return None, None, None, f"{attempt}:miss"


def _extract_embedded_json(html: str) -> Iterable[str]:
    patterns = (
        re.compile(r">\s*(\{\s*\"config\".*?\})\s*<", re.DOTALL),
        re.compile(
            r"window\.__additionalDataLoaded\([^,]+,\s*(\{.*?\})\s*\)",
            re.DOTALL,
        ),
        re.compile(
            r"window\.__initialDataLoaded\([^,]+,\s*(\{.*?\})\s*\)",
            re.DOTALL,
        ),
    )
    for pattern in patterns:
        for match in pattern.finditer(html):
            yield match.group(1)


def _normalize_text(html: str) -> str:
    stripped = re.sub(r"<[^>]+>", " ", html)
    normalized = re.sub(r"\s+", " ", stripped)
    return normalized.strip()


def _extract_first_number(text: str, pattern: re.Pattern[str]) -> Optional[int]:
    match = pattern.search(text)
    if match:
        return parse_compact_number(match.group(1))
    return None


def _extract_from_structures(structures: Iterable[object]) -> Tuple[
    Optional[int],
    Optional[int],
    Optional[int],
]:
    follower_count: Optional[int] = None
    posts_count: Optional[int] = None
    views_count: Optional[int] = None

    stack: list[object] = list(structures)
    while stack:
        node = stack.pop()
        if isinstance(node, dict):
            if follower_count is None:
                follower_count = _extract_followers_from_user(node)
            if posts_count is None:
                posts_count = _extract_posts_from_user(node)
            if views_count is None:
                views_count = _extract_views_from_user(node)
            for value in node.values():
                if isinstance(value, (dict, list)):
                    stack.append(value)
        elif isinstance(node, list):
            for item in node:
                if isinstance(item, (dict, list)):
                    stack.append(item)
        if follower_count is not None and posts_count is not None and views_count is not None:
            break
    return follower_count, posts_count, views_count


def _extract_followers_from_user(node: dict) -> Optional[int]:
    edge_followed_by = node.get("edge_followed_by")
    if isinstance(edge_followed_by, dict):
        count = edge_followed_by.get("count")
        if isinstance(count, int):
            return count
    follower_count = node.get("follower_count") or node.get("followers")
    if isinstance(follower_count, int):
        return follower_count
    return None


def _extract_posts_from_user(node: dict) -> Optional[int]:
    media = node.get("edge_owner_to_timeline_media")
    if isinstance(media, dict):
        posts_value = media.get("count")
        if isinstance(posts_value, int):
            return posts_value
    media_count = node.get("media_count")
    if isinstance(media_count, int):
        return media_count
    return None


def _extract_views_from_user(node: dict) -> Optional[int]:
    for key in ("total_video_view_count", "total_view_count"):
        value = node.get(key)
        if isinstance(value, int) and value >= 0:
            return value
    return None
