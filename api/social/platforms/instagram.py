from __future__ import annotations

import json
import os
import re
from dataclasses import replace
from typing import Optional, Tuple

from requests import RequestException, Response

from ..context import PlatformContext
from ..models import AccountStats
from ..settings import SCRAPER_TIMEOUT_SECONDS
from ..utils import parse_compact_number

INSTAGRAM_LD_JSON_RE = re.compile(
    r"<script type=\"application/ld\+json\">(\{.*?\})</script>",
    re.DOTALL | re.IGNORECASE,
)
INSTAGRAM_NEXT_DATA_RE = re.compile(
    r"<script[^>]+id=\"__NEXT_DATA__\"[^>]*>(\{.*?\})</script>",
    re.DOTALL | re.IGNORECASE,
)
INSTAGRAM_FOLLOWERS_TEXT_RE = re.compile(
    r"([0-9][0-9.,\u00a0]*)\s*([KMB]?)\s+followers",
    re.IGNORECASE,
)


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
    views_snapshot: Optional[int] = None

    attempts = [
        ("direct", url),
        ("text-proxy", url),
    ]

    for attempt, target_url in attempts:
        body: str
        if attempt == "direct":
            response = context.request(target_url, "instagram", handle, attempt)
            body = response.text if isinstance(response, Response) and response.ok else ""
        else:
            body = context.fetch_text(target_url, "instagram", handle) or ""
        count, posts, views, source = _parse_instagram_html(
            body, handle, attempt, target_url, context
        )
        if posts is not None and posts_snapshot is None:
            posts_snapshot = posts
        if views is not None and views_snapshot is None:
            views_snapshot = views
        if count is not None:
            extra = {}
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
        extra={
            key: value
            for key, value in {
                "posts": posts_snapshot,
                "views": views_snapshot,
            }.items()
            if value is not None
        }
        or None,
    )


def _parse_instagram_html(
    payload: str,
    handle: str,
    attempt: str,
    url: str,
    context: PlatformContext,
) -> Tuple[Optional[int], Optional[int], Optional[int], str]:
    if not payload:
        _log_instagram_parse(context, handle, attempt, "empty", None, None, None, False)
        return None, None, None, attempt

    followers = None
    posts = None
    views = None

    next_data_match = INSTAGRAM_NEXT_DATA_RE.search(payload)
    if next_data_match:
        try:
            next_data = json.loads(next_data_match.group(1))
        except json.JSONDecodeError:
            next_data = None
        followers, posts = _extract_from_instagram_data(next_data)
        _log_instagram_parse(
            context,
            handle,
            attempt,
            "next-data",
            followers,
            views,
            posts,
            followers is not None,
        )
        if followers is not None:
            return followers, posts, views, f"{attempt}:next-data"

    ld_match = INSTAGRAM_LD_JSON_RE.search(payload)
    if ld_match:
        try:
            ld_data = json.loads(ld_match.group(1))
        except json.JSONDecodeError:
            ld_data = None
        followers_ld, posts_ld = _extract_from_instagram_data(ld_data)
        _log_instagram_parse(
            context,
            handle,
            attempt,
            "ld-json",
            followers_ld,
            views,
            posts_ld,
            followers_ld is not None,
        )
        if followers_ld is not None:
            return followers_ld, posts_ld, views, f"{attempt}:ld-json"

    match = INSTAGRAM_FOLLOWERS_TEXT_RE.search(payload)
    if match:
        followers_text = " ".join(match.groups())
        followers_value = _coerce_number(followers_text)
        _log_instagram_parse(
            context,
            handle,
            attempt,
            "regex-followers",
            followers_value,
            views,
            posts,
            followers_value is not None,
        )
        if followers_value is not None:
            return followers_value, posts, views, f"{attempt}:regex"

    _log_instagram_parse(
        context,
        handle,
        attempt,
        "miss",
        None,
        views,
        posts,
        False,
    )
    return None, posts, views, attempt


def _extract_from_instagram_data(
    data: object,
) -> Tuple[Optional[int], Optional[int]]:
    followers: Optional[int] = None
    posts: Optional[int] = None
    stack = [data]
    while stack and (followers is None or posts is None):
        current = stack.pop()
        if isinstance(current, dict):
            edge_followed_by = current.get("edge_followed_by")
            if (
                followers is None
                and isinstance(edge_followed_by, dict)
                and isinstance(edge_followed_by.get("count"), int)
            ):
                followers = edge_followed_by["count"]
            follower_count = current.get("follower_count")
            if followers is None and isinstance(follower_count, int):
                followers = follower_count
            if followers is None:
                name = current.get("name")
                interaction_count = current.get("userInteractionCount")
                if (
                    isinstance(name, str)
                    and name.lower() == "followers"
                    and isinstance(interaction_count, int)
                ):
                    followers = interaction_count
            media = current.get("edge_owner_to_timeline_media")
            if (
                posts is None
                and isinstance(media, dict)
                and isinstance(media.get("count"), int)
            ):
                posts = media["count"]
            media_count = current.get("media_count")
            if posts is None and isinstance(media_count, int):
                posts = media_count
            for value in current.values():
                stack.append(value)
        elif isinstance(current, list):
            stack.extend(current)
    return followers, posts


def _log_instagram_parse(
    context: PlatformContext,
    handle: str,
    attempt: str,
    stage: str,
    followers: Optional[int],
    views: Optional[int],
    posts: Optional[int],
    success: bool,
) -> None:
    context.logger.info(
        "instagram handle=%s source=%s stage=%s followers=%s views=%s posts=%s success=%s",
        handle,
        attempt,
        stage,
        followers if followers is not None else "null",
        views if views is not None else "null",
        posts if posts is not None else "null",
        success,
    )


def _coerce_number(text: str) -> Optional[int]:
    digits = re.sub(r"[^0-9]", "", text)
    digits_value: Optional[int]
    if digits:
        try:
            digits_value = int(digits)
        except ValueError:
            digits_value = None
    else:
        digits_value = None
    numeric = parse_compact_number(text)
    if digits_value is not None:
        if numeric is None or digits_value > numeric:
            return digits_value
    return numeric
