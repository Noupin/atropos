from __future__ import annotations

import json
import os
import re
from dataclasses import replace
from typing import Dict, Optional, Tuple

from requests import RequestException

from ..context import PlatformContext
from ..models import AccountStats
from ..settings import SCRAPER_TIMEOUT_SECONDS
from ..utils import parse_compact_number

NEXT_DATA_RE = re.compile(
    r"<script type=\"application/json\" id=\"__NEXT_DATA__\">(\{.*?\})</script>",
    re.DOTALL | re.IGNORECASE,
)
EDGE_FOLLOWED_BY_RE = re.compile(r'"edge_followed_by"\s*:\s*\{\s*"count"\s*:\s*(\d+)', re.IGNORECASE)
FOLLOWER_COUNT_RE = re.compile(r'"follower_count"\s*:\s*(\d+)', re.IGNORECASE)
POSTS_JSON_RE = re.compile(
    r'"edge_owner_to_timeline_media"\s*:\s*\{[^{}]*"count"\s*:\s*(\d+)',
    re.IGNORECASE | re.DOTALL,
)
MEDIA_COUNT_RE = re.compile(r'"media_count"\s*:\s*(\d+)', re.IGNORECASE)
FOLLOWERS_TEXT_RE = re.compile(
    r"([0-9][0-9.,\u00a0]*)\s+followers",
    re.IGNORECASE,
)
POSTS_TEXT_RE = re.compile(r"([0-9][0-9.,\u00a0]*)\s+posts", re.IGNORECASE)


def resolve(handle: str, context: PlatformContext) -> AccountStats:
    scrape_result = _fetch_instagram_scrape(handle, context)
    if scrape_result.count is not None:
        return scrape_result

    access_token = os.environ.get("SOCIAL_INSTAGRAM_ACCESS_TOKEN")
    user_id = os.environ.get("SOCIAL_INSTAGRAM_USER_ID")
    if not (access_token and user_id):
        return scrape_result

    api_result = _fetch_instagram_api(user_id, access_token, handle, context)
    scrape_extra = scrape_result.extra if isinstance(scrape_result.extra, dict) else {}
    api_extra = api_result.extra if isinstance(api_result.extra, dict) else {}
    merged_extra: Dict[str, object] = dict(scrape_extra)
    for key, value in api_extra.items():
        merged_extra[key] = value
    if merged_extra and merged_extra != api_result.extra:
        api_result = replace(api_result, extra=merged_extra)
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
                is_mock=True,
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
            is_mock=True,
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
        is_mock=True,
    )


def _fetch_instagram_scrape(handle: str, context: PlatformContext) -> AccountStats:
    slug = handle.lstrip("@")
    url = f"https://www.instagram.com/{slug}/"
    posts_snapshot: Optional[int] = None
    for attempt in ("text-proxy", "direct"):
        outcome = context.request(url, "instagram", handle, attempt)
        html = (
            outcome.response.text
            if outcome.response is not None and outcome.response.ok
            else ""
        )
        followers, posts, detail = _parse_instagram_html(handle, html)
        if posts is not None and posts_snapshot is None:
            posts_snapshot = posts
        parse_type = "followers" if followers is not None else "miss"
        context.log_attempt(
            "instagram",
            handle,
            outcome,
            parse_type,
            followers,
            None,
            detail,
        )
        if followers is not None:
            extra: Dict[str, object] = {}
            final_posts = posts if posts is not None else posts_snapshot
            if final_posts is not None:
                extra["posts"] = final_posts
            return AccountStats(
                handle=handle,
                count=followers,
                fetched_at=context.now(),
                source=f"scrape:{detail or attempt}",
                extra=extra or None,
            )
    extra: Dict[str, object] = {}
    if posts_snapshot is not None:
        extra["posts"] = posts_snapshot
    return AccountStats(
        handle=handle,
        count=None,
        fetched_at=context.now(),
        source="scrape",
        error="Missing followers",
        is_mock=True,
        extra=extra or None,
    )


def _parse_instagram_html(
    handle: str, html: str
) -> Tuple[Optional[int], Optional[int], Optional[str]]:
    if not html:
        return None, None, "empty-html"
    slug = handle.lstrip("@").lower()
    detail_parts = []
    followers: Optional[int] = None
    posts: Optional[int] = None

    next_match = NEXT_DATA_RE.search(html)
    if next_match:
        try:
            data = json.loads(next_match.group(1))
        except json.JSONDecodeError:
            data = None
        if isinstance(data, dict):
            json_followers, json_posts = _extract_from_instagram_json(data, slug)
            if json_followers is not None:
                followers = json_followers
                detail_parts.append("next-data-followers")
            if json_posts is not None:
                posts = json_posts
                detail_parts.append("next-data-posts")
    else:
        detail_parts.append("next-data-missing")

    if followers is None:
        edge_match = EDGE_FOLLOWED_BY_RE.search(html)
        if edge_match:
            followers = int(edge_match.group(1))
            detail_parts.append("edge-followed-by")
    if followers is None:
        count_match = FOLLOWER_COUNT_RE.search(html)
        if count_match:
            followers = int(count_match.group(1))
            detail_parts.append("follower-count")
    if followers is None:
        text_match = FOLLOWERS_TEXT_RE.search(html)
        if text_match:
            parsed = parse_compact_number(text_match.group(1))
            if parsed is not None:
                followers = parsed
                detail_parts.append("text-followers")

    if posts is None:
        posts_match = POSTS_JSON_RE.search(html)
        if posts_match:
            posts = int(posts_match.group(1))
            detail_parts.append("posts-json")
    if posts is None:
        media_match = MEDIA_COUNT_RE.search(html)
        if media_match:
            posts = int(media_match.group(1))
            detail_parts.append("media-count")
    if posts is None:
        posts_text = POSTS_TEXT_RE.search(html)
        if posts_text:
            parsed_posts = parse_compact_number(posts_text.group(1))
            if parsed_posts is not None:
                posts = parsed_posts
                detail_parts.append("text-posts")

    detail = " ".join(detail_parts) if detail_parts else None
    return followers, posts, detail


def _extract_from_instagram_json(
    data: object, slug: str
) -> Tuple[Optional[int], Optional[int]]:
    followers: Optional[int] = None
    posts: Optional[int] = None
    stack = [data]
    while stack:
        node = stack.pop()
        if isinstance(node, dict):
            username = node.get("username") if isinstance(node.get("username"), str) else None
            is_target = isinstance(username, str) and username.lower() == slug
            follower_candidate = _extract_follower_candidate(node)
            posts_candidate = _extract_posts_candidate(node)
            if follower_candidate is not None:
                if is_target or followers is None:
                    followers = follower_candidate
            if posts_candidate is not None:
                if is_target or posts is None:
                    posts = posts_candidate
            for value in node.values():
                stack.append(value)
        elif isinstance(node, list):
            stack.extend(node)
    return followers, posts


def _extract_follower_candidate(node: Dict[str, object]) -> Optional[int]:
    edge = node.get("edge_followed_by")
    if isinstance(edge, dict):
        count = edge.get("count")
        if isinstance(count, int):
            return count
    follower_count = node.get("follower_count")
    if isinstance(follower_count, int):
        return follower_count
    return None


def _extract_posts_candidate(node: Dict[str, object]) -> Optional[int]:
    media = node.get("edge_owner_to_timeline_media")
    if isinstance(media, dict):
        count = media.get("count")
        if isinstance(count, int):
            return count
    media_count = node.get("media_count")
    if isinstance(media_count, int):
        return media_count
    return None
