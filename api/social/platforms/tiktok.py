from __future__ import annotations

import json
import re
from typing import Optional, Tuple

from requests import Response

from ..context import PlatformContext
from ..models import AccountStats
from ..utils import parse_compact_number

TIKTOK_SIGI_RE = re.compile(
    r"<script id=\"SIGI_STATE\">(.*?)</script>", re.DOTALL | re.IGNORECASE
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
        "tiktok handle=%s attempt=%s status=%s followers=%s views=%s source=%s",
        handle,
        attempt,
        status if status is not None else "error",
        followers if followers is not None else "null",
        views if views is not None else "null",
        source,
    )


def resolve(handle: str, context: PlatformContext) -> AccountStats:
    return _fetch_tiktok_scrape(handle, context)


def _fetch_tiktok_scrape(handle: str, context: PlatformContext) -> AccountStats:
    slug = handle.lstrip("@")
    url = f"https://www.tiktok.com/@{slug}"
    response = context.request(url, "tiktok", handle, "direct")
    status = response.status_code if isinstance(response, Response) else None
    html = response.text if isinstance(response, Response) and response.ok else ""
    count, views, source = _parse_tiktok_html(html, handle, "direct", url, context)
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
    proxy_html = context.fetch_text(url, "tiktok", handle)
    count, views, source = _parse_tiktok_html(
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
        error="Missing follower count",
        is_mock=True,
    )


def _parse_tiktok_html(
    html: str,
    handle: str,
    attempt: str,
    url: str,
    context: PlatformContext,
) -> Tuple[Optional[int], Optional[int], str]:
    if not html:
        context.logger.info(
            "tiktok handle=%s attempt=%s url=%s parse=empty",
            handle,
            attempt,
            url,
        )
        return None, None, attempt
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
            views_capture: Optional[int] = None
            if isinstance(users, dict):
                for key, entry in users.items():
                    if not isinstance(entry, dict):
                        continue
                    unique = (entry.get("uniqueId") or "").lower()
                    if unique == slug or key.lower() == slug:
                        count = entry.get("followerCount")
                        if views_capture is None:
                            views_capture = _extract_views_from_entry(entry)
                        if isinstance(count, int):
                            context.logger.info(
                                "tiktok handle=%s attempt=%s parse=SIGI_STATE-users count=%s",
                                handle,
                                attempt,
                                count,
                            )
                            return count, views_capture, f"{attempt}:sigi-users"
            if isinstance(stats, dict):
                for key, entry in stats.items():
                    if not isinstance(entry, dict):
                        continue
                    count = entry.get("followerCount")
                    if views_capture is None:
                        views_capture = _extract_views_from_entry(entry)
                    if isinstance(count, int):
                        context.logger.info(
                            "tiktok handle=%s attempt=%s parse=SIGI_STATE-stats count=%s",
                            handle,
                            attempt,
                            count,
                        )
                        return count, views_capture, f"{attempt}:sigi-stats"
    regex_match = re.search(r'"followerCount"\s*:\s*([0-9]+)', html)
    if regex_match:
        count = int(regex_match.group(1))
        context.logger.info(
            "tiktok handle=%s attempt=%s parse=regex-json count=%s",
            handle,
            attempt,
            count,
        )
        return count, None, f"{attempt}:regex-json"
    fallback_match = re.search(
        r"([0-9][0-9.,\u00a0]*)\s+Followers", html, re.IGNORECASE
    )
    if fallback_match:
        count = parse_compact_number(fallback_match.group(1))
        if count is not None:
            context.logger.info(
                "tiktok handle=%s attempt=%s parse=regex-text count=%s",
                handle,
                attempt,
                count,
            )
            return count, None, f"{attempt}:regex-text"
    context.logger.info(
        "tiktok handle=%s attempt=%s url=%s parse=miss",
        handle,
        attempt,
        url,
    )
    return None, None, attempt


def _extract_views_from_entry(entry: dict) -> Optional[int]:
    for key in ("videoViewCount", "viewCount", "videoView", "totalViewCount"):
        value = entry.get(key) if isinstance(entry, dict) else None
        if isinstance(value, int) and value >= 0:
            return value
    return None
