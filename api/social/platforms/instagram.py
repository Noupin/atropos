from __future__ import annotations

import os
import re
from dataclasses import replace
from typing import Optional, Tuple

from requests import RequestException

from ..context import PlatformContext
from ..models import AccountStats
from ..settings import SCRAPER_TIMEOUT_SECONDS
from ..utils import extract_json_blob, log_attempt_result, parse_compact_number

INSTAGRAM_NEXT_DATA_RE = re.compile(
    r"<script[^>]+id=\"__NEXT_DATA__\"[^>]*>(\{.*?\})</script>",
    re.DOTALL | re.IGNORECASE,
)
INSTAGRAM_SHARED_DATA_RE = re.compile(
    r"window\._sharedData\s*=\s*(\{.*?\})\s*;",
    re.DOTALL | re.IGNORECASE,
)
INSTAGRAM_FOLLOWERS_RE = re.compile(
    r"([0-9][0-9.,\u00a0]*\s*[KMB]?)\s*(?:followers|follower)\b",
    re.IGNORECASE,
)
INSTAGRAM_POSTS_RE = re.compile(
    r"([0-9][0-9.,\u00a0]*\s*[KMB]?)\s+posts",
    re.IGNORECASE,
)


def resolve(handle: str, context: PlatformContext) -> AccountStats:
    scrape_result = _fetch_instagram_scrape(handle, context)
    if scrape_result.count is not None:
        return scrape_result

    posts_snapshot = None
    if isinstance(scrape_result.extra, dict):
        posts_value = scrape_result.extra.get("posts")
        if isinstance(posts_value, int):
            posts_snapshot = posts_value

    access_token = os.environ.get("SOCIAL_INSTAGRAM_ACCESS_TOKEN")
    user_id = os.environ.get("SOCIAL_INSTAGRAM_USER_ID")
    if not (access_token and user_id):
        return scrape_result

    api_result = _fetch_instagram_api(user_id, access_token, handle, context)
    if posts_snapshot is not None:
        existing_extra = dict(api_result.extra or {})
        if "posts" not in existing_extra and posts_snapshot is not None:
            existing_extra["posts"] = posts_snapshot
        api_result = replace(api_result, extra=existing_extra or None)
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

    direct = context.request(url, "instagram", handle, "direct")
    count, posts, source = _parse_instagram_html(
        direct.text or "", handle, "direct", url, context
    )
    if posts is not None:
        posts_snapshot = posts
    log_attempt_result(
        context.logger,
        "instagram",
        handle,
        "direct",
        direct.status,
        count,
        None,
        direct.elapsed,
    )
    if count is not None:
        return AccountStats(
            handle=handle,
            count=count,
            fetched_at=context.now(),
            source=f"scrape:{source}",
            extra={"posts": posts if posts is not None else posts_snapshot}
            if (posts is not None or posts_snapshot is not None)
            else None,
        )

    proxy = context.fetch_text(url, "instagram", handle)
    count, posts, source = _parse_instagram_html(
        proxy.text or "", handle, "text-proxy", url, context
    )
    if posts is not None and posts_snapshot is None:
        posts_snapshot = posts
    log_attempt_result(
        context.logger,
        "instagram",
        handle,
        "text-proxy",
        proxy.status,
        count,
        None,
        proxy.elapsed,
    )
    if count is not None:
        return AccountStats(
            handle=handle,
            count=count,
            fetched_at=context.now(),
            source=f"scrape:{source}",
            extra={"posts": posts if posts is not None else posts_snapshot}
            if (posts is not None or posts_snapshot is not None)
            else None,
        )
    return AccountStats(
        handle=handle,
        count=None,
        fetched_at=context.now(),
        source="scrape",
        error="Missing followers",
        extra={"posts": posts_snapshot} if posts_snapshot is not None else None,
    )


def _parse_instagram_html(
    html: str,
    handle: str,
    attempt: str,
    url: str,
    context: PlatformContext,
) -> Tuple[Optional[int], Optional[int], str]:
    if not html:
        context.logger.info(
            "instagram handle=%s attempt=%s url=%s parse=empty",
            handle,
            attempt,
            url,
        )
        return None, None, attempt

    posts_count: Optional[int] = None
    data, label = _extract_instagram_json(html)
    if isinstance(data, dict):
        followers, posts = _search_instagram_counts(data)
        if posts is not None:
            posts_count = posts
        if followers is not None:
            context.logger.info(
                "instagram handle=%s attempt=%s parse=%s count=%s",
                handle,
                attempt,
                label,
                followers,
            )
            return followers, posts_count, f"{attempt}:{label}"
        context.logger.info(
            "instagram handle=%s attempt=%s parse=%s-miss",
            handle,
            attempt,
            label,
        )

    if posts_count is None:
        posts_count = _extract_posts_from_html(html, handle, attempt, context)

    followers_text = _extract_followers_from_html(html, handle, attempt, context)
    if followers_text is not None:
        return followers_text, posts_count, f"{attempt}:followers-text"

    context.logger.info(
        "instagram handle=%s attempt=%s url=%s parse=miss",
        handle,
        attempt,
        url,
    )
    return None, posts_count, attempt


def _extract_instagram_json(html: str) -> Tuple[Optional[dict], str]:
    data = extract_json_blob(html, INSTAGRAM_NEXT_DATA_RE)
    if isinstance(data, dict):
        return data, "next-data"
    data = extract_json_blob(html, INSTAGRAM_SHARED_DATA_RE)
    if isinstance(data, dict):
        return data, "shared-data"
    return None, "json"


def _search_instagram_counts(node: object) -> Tuple[Optional[int], Optional[int]]:
    followers: Optional[int] = None
    posts: Optional[int] = None
    stack = [node]
    while stack:
        current = stack.pop()
        if isinstance(current, dict):
            if followers is None:
                edge_followed_by = current.get("edge_followed_by")
                if isinstance(edge_followed_by, dict):
                    count = edge_followed_by.get("count")
                    if isinstance(count, int):
                        followers = count
                follower_count = current.get("follower_count")
                if isinstance(follower_count, int):
                    followers = follower_count
            if posts is None:
                timeline = current.get("edge_owner_to_timeline_media")
                if isinstance(timeline, dict):
                    timeline_count = timeline.get("count")
                    if isinstance(timeline_count, int):
                        posts = timeline_count
                for key in ("media_count", "posts_count"):
                    value = current.get(key)
                    if isinstance(value, int):
                        posts = value
                        break
            stack.extend(current.values())
        elif isinstance(current, list):
            stack.extend(current)
    return followers, posts


def _extract_followers_from_html(
    html: str, handle: str, attempt: str, context: PlatformContext
) -> Optional[int]:
    match = INSTAGRAM_FOLLOWERS_RE.search(html)
    if not match:
        return None
    count = parse_compact_number(match.group(1))
    if count is not None:
        context.logger.info(
            "instagram handle=%s attempt=%s parse=regex-followers count=%s",
            handle,
            attempt,
            count,
        )
    return count


def _extract_posts_from_html(
    html: str, handle: str, attempt: str, context: PlatformContext
) -> Optional[int]:
    match = INSTAGRAM_POSTS_RE.search(html)
    if not match:
        return None
    posts = parse_compact_number(match.group(1))
    if posts is not None:
        context.logger.info(
            "instagram handle=%s attempt=%s parse=regex-posts count=%s",
            handle,
            attempt,
            posts,
        )
    return posts
