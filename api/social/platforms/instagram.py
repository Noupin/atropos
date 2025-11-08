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

INSTAGRAM_LD_JSON_RE = re.compile(
    r"<script type=\"application/ld\+json\">(\{.*?\})</script>",
    re.DOTALL | re.IGNORECASE,
)

# Pattern to extract __NEXT_DATA__ from Instagram HTML
INSTAGRAM_NEXT_DATA_RE = re.compile(
    r'<script[^>]*id="__NEXT_DATA__"[^>]*type="application/json"[^>]*>([^<]+)</script>',
    re.DOTALL | re.IGNORECASE,
)

# Fallback regex patterns for text content
INSTAGRAM_FOLLOWERS_RE = re.compile(
    r'([0-9][0-9.,KMB]*)\s+[Ff]ollowers',
    re.IGNORECASE,
)

INSTAGRAM_POSTS_RE = re.compile(
    r'([0-9][0-9.,KMB]*)\s+[Pp]osts',
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
    """Fetch Instagram profile stats by parsing public HTML page."""
    slug = handle.lstrip("@")
    url = f"https://www.instagram.com/{slug}/"

    # Try direct request first
    response = context.request(url, "instagram", handle, "direct")
    body = response.text if isinstance(response, Response) and response.ok else ""
    count, posts, views, source = _parse_instagram_html(
        body, handle, "direct", url, context
    )

    if count is not None:
        context.logger.info(
            "instagram handle=%s source=direct parsed_followers=%s parsed_posts=%s parsed_views=%s",
            handle, count, posts, views
        )
        extra = {}
        if posts is not None:
            extra["posts"] = posts
        if views is not None:
            extra["views"] = views
        return AccountStats(
            handle=handle,
            count=count,
            fetched_at=context.now(),
            source=f"scrape:{source}",
            extra=extra if extra else None,
        )

    # Try text proxy if direct failed
    proxy_body = context.fetch_text(url, "instagram", handle)
    count, posts, views, source = _parse_instagram_html(
        proxy_body or "", handle, "text-proxy", url, context
    )

    if count is not None:
        context.logger.info(
            "instagram handle=%s source=text-proxy parsed_followers=%s parsed_posts=%s parsed_views=%s",
            handle, count, posts, views
        )
        extra = {}
        if posts is not None:
            extra["posts"] = posts
        if views is not None:
            extra["views"] = views
        return AccountStats(
            handle=handle,
            count=count,
            fetched_at=context.now(),
            source=f"scrape:{source}",
            extra=extra if extra else None,
        )

    context.logger.warning(
        "instagram handle=%s parse_failed=true", handle
    )
    return AccountStats(
        handle=handle,
        count=None,
        fetched_at=context.now(),
        source="scrape",
        error="Missing followers",
    )


def _parse_number_with_suffix(text: str) -> Optional[int]:
    """Parse number strings like '1.2K', '3.5M', '10B' to integers."""
    if not text:
        return None
    text = text.strip().replace(",", "")
    multiplier = 1
    if text[-1].upper() == "K":
        multiplier = 1000
        text = text[:-1]
    elif text[-1].upper() == "M":
        multiplier = 1000000
        text = text[:-1]
    elif text[-1].upper() == "B":
        multiplier = 1000000000
        text = text[:-1]
    try:
        number = float(text)
        return int(number * multiplier)
    except (ValueError, TypeError):
        return None


def _parse_instagram_html(
    html: str,
    handle: str,
    attempt: str,
    url: str,
    context: PlatformContext,
) -> Tuple[Optional[int], Optional[int], Optional[int], str]:
    """
    Parse Instagram HTML to extract followers, posts, and views.
    Returns: (followers, posts, views, source)

    Instagram doesn't expose total profile views publicly, so views will always be None.
    """
    if not html:
        context.logger.info(
            "instagram handle=%s attempt=%s url=%s parse=empty",
            handle,
            attempt,
            url,
        )
        return None, None, None, attempt

    followers: Optional[int] = None
    posts: Optional[int] = None
    views: Optional[int] = None  # Instagram doesn't provide public view counts
    source = attempt

    # Try to extract __NEXT_DATA__ JSON
    next_data_match = INSTAGRAM_NEXT_DATA_RE.search(html)
    if next_data_match:
        try:
            next_data = json.loads(next_data_match.group(1))
            context.logger.info(
                "instagram handle=%s attempt=%s parse=__NEXT_DATA__ found=true",
                handle,
                attempt,
            )

            # Navigate through __NEXT_DATA__ structure
            # Path: props.pageProps.user or props.pageProps.data.user
            if isinstance(next_data, dict):
                props = next_data.get("props", {})
                if isinstance(props, dict):
                    page_props = props.get("pageProps", {})
                    if isinstance(page_props, dict):
                        # Try direct user object
                        user = page_props.get("user")
                        if not isinstance(user, dict):
                            # Try nested data.user
                            data = page_props.get("data", {})
                            if isinstance(data, dict):
                                user = data.get("user")

                        if isinstance(user, dict):
                            # Extract follower count
                            follower_count = user.get("follower_count")
                            edge_followed_by = user.get("edge_followed_by", {})
                            if isinstance(follower_count, int):
                                followers = follower_count
                            elif isinstance(edge_followed_by, dict):
                                followers = edge_followed_by.get("count")

                            # Extract posts count
                            media_count = user.get("media_count")
                            edge_media = user.get("edge_owner_to_timeline_media", {})
                            if isinstance(media_count, int):
                                posts = media_count
                            elif isinstance(edge_media, dict):
                                posts = edge_media.get("count")

                            if followers is not None:
                                source = f"{attempt}:__NEXT_DATA__"
                                context.logger.info(
                                    "instagram handle=%s attempt=%s parse=__NEXT_DATA__ followers=%s posts=%s",
                                    handle,
                                    attempt,
                                    followers,
                                    posts,
                                )
                                return followers, posts, views, source
        except (json.JSONDecodeError, KeyError, TypeError) as e:
            context.logger.info(
                "instagram handle=%s attempt=%s parse=__NEXT_DATA__ error=%s",
                handle,
                attempt,
                str(e),
            )

    # Try LD+JSON as fallback
    ld_match = INSTAGRAM_LD_JSON_RE.search(html)
    if ld_match:
        try:
            ld_data = json.loads(ld_match.group(1))
            if isinstance(ld_data, dict):
                stats = ld_data.get("interactionStatistic")
                if isinstance(stats, list):
                    for entry in stats:
                        if not isinstance(entry, dict):
                            continue
                        if entry.get("name") == "Followers":
                            count = entry.get("userInteractionCount")
                            if isinstance(count, int):
                                followers = count
                                source = f"{attempt}:ld-json"
                                context.logger.info(
                                    "instagram handle=%s attempt=%s parse=ld-json followers=%s",
                                    handle,
                                    attempt,
                                    followers,
                                )
                                return followers, posts, views, source
        except (json.JSONDecodeError, KeyError, TypeError) as e:
            context.logger.info(
                "instagram handle=%s attempt=%s parse=ld-json error=%s",
                handle,
                attempt,
                str(e),
            )

    # Regex fallback for followers
    if followers is None:
        followers_match = INSTAGRAM_FOLLOWERS_RE.search(html)
        if followers_match:
            followers = _parse_number_with_suffix(followers_match.group(1))
            if followers is not None:
                source = f"{attempt}:regex-followers"
                context.logger.info(
                    "instagram handle=%s attempt=%s parse=regex-followers followers=%s",
                    handle,
                    attempt,
                    followers,
                )

    # Regex fallback for posts
    if posts is None:
        posts_match = INSTAGRAM_POSTS_RE.search(html)
        if posts_match:
            posts = _parse_number_with_suffix(posts_match.group(1))

    if followers is not None:
        return followers, posts, views, source

    context.logger.warning(
        "instagram handle=%s attempt=%s url=%s parse=miss",
        handle,
        attempt,
        url,
    )
    return None, posts, views, attempt
