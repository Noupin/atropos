from __future__ import annotations

import json
import re
from typing import Optional, Tuple

from requests import Response

from ..context import PlatformContext
from ..models import AccountStats
from ..utils import parse_compact_number

INSTAGRAM_LD_JSON_RE = re.compile(
    r"<script type=\"application/ld\+json\">(\{.*?\})</script>",
    re.DOTALL | re.IGNORECASE,
)
INSTAGRAM_NEXT_DATA_RE = re.compile(
    r"<script[^>]*id=\"__NEXT_DATA__\"[^>]*type=\"application/json\"[^>]*>(.*?)</script>",
    re.DOTALL | re.IGNORECASE,
)
INSTAGRAM_FOLLOWERS_COMPACT_RE = re.compile(
    r"([0-9][0-9.,\u00a0]*\s*[KMB]?)\s+followers",
    re.IGNORECASE,
)


def resolve(handle: str, context: PlatformContext) -> AccountStats:
    return _fetch_instagram_scrape(handle, context)


def _fetch_instagram_scrape(handle: str, context: PlatformContext) -> AccountStats:
    slug = handle.lstrip("@")
    url = f"https://www.instagram.com/{slug}/"

    # Try direct request first
    response = context.request(url, "instagram", handle, "direct")
    html = response.text if isinstance(response, Response) and response.ok else ""
    count, posts, source = _parse_instagram_html(html, handle, "direct", url, context)
    if count is not None:
        extra = {"posts": posts} if posts is not None else None
        context.logger.info(
            "instagram handle=%s source=direct parsed_followers=%s parsed_posts=%s parse_status=hit",
            handle,
            count,
            posts,
        )
        return AccountStats(
            handle=handle,
            count=count,
            fetched_at=context.now(),
            source=f"scrape:{source}",
            extra=extra,
        )

    # Try text-proxy fallback
    proxy_html = context.fetch_text(url, "instagram", handle)
    count, posts, source = _parse_instagram_html(
        proxy_html or "", handle, "text-proxy", url, context
    )
    if count is not None:
        extra = {"posts": posts} if posts is not None else None
        context.logger.info(
            "instagram handle=%s source=text-proxy parsed_followers=%s parsed_posts=%s parse_status=hit",
            handle,
            count,
            posts,
        )
        return AccountStats(
            handle=handle,
            count=count,
            fetched_at=context.now(),
            source=f"scrape:{source}",
            extra=extra,
        )

    context.logger.info(
        "instagram handle=%s source=direct,text-proxy parsed_followers=null parsed_posts=null parse_status=miss",
        handle,
    )
    return AccountStats(
        handle=handle,
        count=None,
        fetched_at=context.now(),
        source="scrape",
        error="Missing followers",
    )


def _parse_instagram_html(
    html: str,
    handle: str,
    attempt: str,
    url: str,
    context: PlatformContext,
) -> Tuple[Optional[int], Optional[int], str]:
    """Parse Instagram HTML for follower count and posts.

    Returns: (follower_count, posts_count, parse_method)
    """
    if not html:
        context.logger.info(
            "instagram handle=%s attempt=%s url=%s parse=empty",
            handle,
            attempt,
            url,
        )
        return None, None, attempt

    posts_count: Optional[int] = None

    # Try NEXT_DATA JSON (graph/entry_data style)
    next_data_match = INSTAGRAM_NEXT_DATA_RE.search(html)
    if next_data_match:
        try:
            next_data = json.loads(next_data_match.group(1))
            if isinstance(next_data, dict):
                # Navigate through props.pageProps or similar structures
                props = next_data.get("props", {})
                page_props = props.get("pageProps", {}) if isinstance(props, dict) else {}

                # Look for user data in various locations
                user_data = None
                if isinstance(page_props, dict):
                    user_data = page_props.get("user") or page_props.get("graphql", {}).get("user")

                if isinstance(user_data, dict):
                    # Extract follower count
                    edge_followed_by = user_data.get("edge_followed_by", {})
                    if isinstance(edge_followed_by, dict):
                        count = edge_followed_by.get("count")
                        if isinstance(count, int):
                            # Also try to get posts count
                            media = user_data.get("edge_owner_to_timeline_media", {})
                            if isinstance(media, dict):
                                posts_value = media.get("count")
                                if isinstance(posts_value, int):
                                    posts_count = posts_value

                            context.logger.info(
                                "instagram handle=%s attempt=%s parse=next_data count=%s",
                                handle,
                                attempt,
                                count,
                            )
                            return count, posts_count, f"{attempt}:next_data"
        except json.JSONDecodeError:
            pass

    # Try LD-JSON structured data
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
                                context.logger.info(
                                    "instagram handle=%s attempt=%s parse=ld-json count=%s",
                                    handle,
                                    attempt,
                                    count,
                                )
                                return count, posts_count, f"{attempt}:ld-json"
        except json.JSONDecodeError:
            pass

    # Fallback to regex for compact numbers (e.g., "1.2k followers")
    compact_match = INSTAGRAM_FOLLOWERS_COMPACT_RE.search(html)
    if compact_match:
        count = parse_compact_number(compact_match.group(1))
        if count is not None:
            context.logger.info(
                "instagram handle=%s attempt=%s parse=regex-compact count=%s",
                handle,
                attempt,
                count,
            )
            return count, posts_count, f"{attempt}:regex-compact"

    context.logger.info(
        "instagram handle=%s attempt=%s url=%s parse=miss",
        handle,
        attempt,
        url,
    )
    return None, posts_count, attempt
