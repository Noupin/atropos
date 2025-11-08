from __future__ import annotations

import json
import re
from typing import Optional, Tuple

from ..context import PlatformContext
from ..models import AccountStats
from ..utils import parse_compact_number

TIKTOK_SIGI_RE = re.compile(
    r"<script id=\"SIGI_STATE\">(.*?)</script>", re.DOTALL | re.IGNORECASE
)


def resolve(handle: str, context: PlatformContext) -> AccountStats:
    return _fetch_tiktok_scrape(handle, context)


def _fetch_tiktok_scrape(handle: str, context: PlatformContext) -> AccountStats:
    slug = handle.lstrip("@")
    url = f"https://www.tiktok.com/@{slug}"
    response = context.request(url, "tiktok", handle, "direct")
    html = response.text if response and getattr(response, "ok", False) else ""
    count, views, source = _parse_tiktok_html(html, handle, "direct", url, context)
    if count is not None:
        context.logger.info(
            "tiktok handle=%s source=direct parsed_followers=%s parsed_views=%s",
            handle, count, views
        )
        return AccountStats(
            handle=handle,
            count=count,
            fetched_at=context.now(),
            source=f"scrape:{source}",
            extra={"views": views} if views is not None else None,
        )
    proxy_html = context.fetch_text(url, "tiktok", handle)
    count, views, source = _parse_tiktok_html(proxy_html or "", handle, "text-proxy", url, context)
    if count is not None:
        context.logger.info(
            "tiktok handle=%s source=text-proxy parsed_followers=%s parsed_views=%s",
            handle, count, views
        )
        return AccountStats(
            handle=handle,
            count=count,
            fetched_at=context.now(),
            source=f"scrape:{source}",
            extra={"views": views} if views is not None else None,
        )
    return AccountStats(
        handle=handle,
        count=None,
        fetched_at=context.now(),
        source="scrape",
        error="Missing follower count",
    )


def _parse_tiktok_html(
    html: str,
    handle: str,
    attempt: str,
    url: str,
    context: PlatformContext,
) -> Tuple[Optional[int], Optional[int], str]:
    """Parse TikTok HTML for follower count and views.

    Returns: (followers, views, source)
    Note: TikTok doesn't expose total profile views publicly, so views will always be None.
    """
    if not html:
        context.logger.info(
            "tiktok handle=%s attempt=%s url=%s parse=empty",
            handle,
            attempt,
            url,
        )
        return None, None, attempt

    # TikTok doesn't provide public total profile views
    views: Optional[int] = None

    match = TIKTOK_SIGI_RE.search(html)
    if match:
        try:
            data = json.loads(match.group(1))
        except json.JSONDecodeError:
            data = None
        if isinstance(data, dict):
            module = data.get("UserModule", {})
            users = module.get("users", {}) if isinstance(module, dict) else {}
            stats = module.get("stats", {}) if isinstance(module, dict) else {}
            slug = handle.lstrip("@").lower()
            if isinstance(users, dict):
                for key, entry in users.items():
                    if not isinstance(entry, dict):
                        continue
                    unique = (entry.get("uniqueId") or "").lower()
                    if unique == slug or key.lower() == slug:
                        count = entry.get("followerCount")
                        if isinstance(count, int):
                            context.logger.info(
                                "tiktok handle=%s attempt=%s parse=SIGI_STATE-users followers=%s",
                                handle,
                                attempt,
                                count,
                            )
                            return count, views, f"{attempt}:sigi-users"
            if isinstance(stats, dict):
                for key, entry in stats.items():
                    if not isinstance(entry, dict):
                        continue
                    count = entry.get("followerCount")
                    if isinstance(count, int):
                        context.logger.info(
                            "tiktok handle=%s attempt=%s parse=SIGI_STATE-stats followers=%s",
                            handle,
                            attempt,
                            count,
                        )
                        return count, views, f"{attempt}:sigi-stats"
    regex_match = re.search(r'"followerCount"\s*:\s*([0-9]+)', html)
    if regex_match:
        count = int(regex_match.group(1))
        context.logger.info(
            "tiktok handle=%s attempt=%s parse=regex-json followers=%s",
            handle,
            attempt,
            count,
        )
        return count, views, f"{attempt}:regex-json"
    fallback_match = re.search(
        r"([0-9][0-9.,\u00a0]*)\s+Followers", html, re.IGNORECASE
    )
    if fallback_match:
        count = parse_compact_number(fallback_match.group(1))
        if count is not None:
            context.logger.info(
                "tiktok handle=%s attempt=%s parse=regex-text followers=%s",
                handle,
                attempt,
                count,
            )
            return count, views, f"{attempt}:regex-text"
    context.logger.info(
        "tiktok handle=%s attempt=%s url=%s parse=miss",
        handle,
        attempt,
        url,
    )
    return None, views, attempt
