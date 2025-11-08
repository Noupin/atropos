from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Optional

from ..context import PlatformContext
from ..models import AccountStats
from ..utils import log_scrape_attempt, parse_compact_number

TIKTOK_SIGI_RE = re.compile(
    r"<script id=\"SIGI_STATE\">(.*?)</script>", re.DOTALL | re.IGNORECASE
)
TIKTOK_VIEWS_RE = re.compile(
    r"([0-9][0-9.,\u00a0]*\s*[KMB]?)\s+Views?",
    re.IGNORECASE,
)


@dataclass
class TikTokParseResult:
    count: Optional[int]
    views: Optional[int]
    detail: str
    success: bool


def resolve(handle: str, context: PlatformContext) -> AccountStats:
    return _fetch_tiktok_scrape(handle, context)


def _fetch_tiktok_scrape(handle: str, context: PlatformContext) -> AccountStats:
    slug = handle.lstrip("@")
    url = f"https://www.tiktok.com/@{slug}"
    response = context.request(url, "tiktok", handle, "direct")
    html = response.text if response and getattr(response, "ok", False) else ""
    direct_result = _parse_tiktok_html(html, slug)
    log_scrape_attempt(
        context.logger,
        "tiktok",
        handle,
        "direct",
        direct_result.detail,
        direct_result.count,
        direct_result.views,
        direct_result.success,
    )
    if direct_result.count is not None:
        extra = (
            {"views": direct_result.views}
            if isinstance(direct_result.views, int)
            else None
        )
        return AccountStats(
            handle=handle,
            count=direct_result.count,
            fetched_at=context.now(),
            source=f"scrape:direct:{direct_result.detail}",
            extra=extra,
        )
    proxy_html = context.fetch_text(url, "tiktok", handle) or ""
    proxy_result = _parse_tiktok_html(proxy_html, slug)
    log_scrape_attempt(
        context.logger,
        "tiktok",
        handle,
        "text-proxy",
        proxy_result.detail,
        proxy_result.count,
        proxy_result.views,
        proxy_result.success,
    )
    if proxy_result.count is not None:
        extra = (
            {"views": proxy_result.views}
            if isinstance(proxy_result.views, int)
            else None
        )
        return AccountStats(
            handle=handle,
            count=proxy_result.count,
            fetched_at=context.now(),
            source=f"scrape:text-proxy:{proxy_result.detail}",
            extra=extra,
        )
    return AccountStats(
        handle=handle,
        count=None,
        fetched_at=context.now(),
        source="scrape",
        error="Missing follower count",
    )


def _parse_tiktok_html(
    html: str, slug: str
) -> TikTokParseResult:
    if not html:
        return TikTokParseResult(None, None, "empty", False)
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
            normalized_slug = slug.lower()

            def extract_views(entry: dict, current: Optional[int]) -> Optional[int]:
                if not isinstance(entry, dict):
                    return current
                for key in (
                    "playCount",
                    "viewCount",
                    "videoPlayCount",
                    "videoTotalPlayCount",
                    "totalPlayCount",
                ):
                    value = entry.get(key)
                    if isinstance(value, int):
                        return value if current is None else current
                return current

            views: Optional[int] = None
            if isinstance(users, dict):
                for key, entry in users.items():
                    if not isinstance(entry, dict):
                        continue
                    unique = (entry.get("uniqueId") or "").lower()
                    if unique == normalized_slug or key.lower() == normalized_slug:
                        views = extract_views(entry, views)
                        count = entry.get("followerCount")
                        if isinstance(count, int):
                            return TikTokParseResult(
                                count,
                                views,
                                "sigi-users",
                                True,
                            )
            if isinstance(stats, dict):
                for key, entry in stats.items():
                    if not isinstance(entry, dict):
                        continue
                    views = extract_views(entry, views)
                    count = entry.get("followerCount")
                    if isinstance(count, int):
                        return TikTokParseResult(count, views, "sigi-stats", True)
    regex_match = re.search(r'"followerCount"\s*:\s*([0-9]+)', html)
    if regex_match:
        count = int(regex_match.group(1))
        views = _extract_tiktok_views_from_markup(html)
        return TikTokParseResult(count, views, "regex-json", True)
    fallback_match = re.search(
        r"([0-9][0-9.,\u00a0]*)\s+Followers", html, re.IGNORECASE
    )
    if fallback_match:
        count = _parse_tiktok_number(fallback_match.group(1))
        if count is not None:
            views = _extract_tiktok_views_from_markup(html)
            return TikTokParseResult(count, views, "regex-text", True)
    views = _extract_tiktok_views_from_markup(html)
    detail = "views-only" if isinstance(views, int) else "miss"
    return TikTokParseResult(None, views, detail, False)


def _extract_tiktok_views_from_markup(html: str) -> Optional[int]:
    for key in (
        "playCount",
        "viewCount",
        "videoPlayCount",
        "videoTotalPlayCount",
        "totalPlayCount",
    ):
        match = re.search(rf'"{key}"\s*:\s*([0-9]+)', html)
        if match:
            try:
                return int(match.group(1))
            except ValueError:
                continue
    text_match = TIKTOK_VIEWS_RE.search(html)
    if text_match:
        return _parse_tiktok_number(text_match.group(1))
    return None


def _parse_tiktok_number(token: str) -> Optional[int]:
    if not token:
        return None
    if re.search(r"[KMB]", token, re.IGNORECASE):
        return parse_compact_number(token)
    digits = re.sub(r"[^0-9]", "", token)
    if digits:
        return int(digits)
    return parse_compact_number(token)
