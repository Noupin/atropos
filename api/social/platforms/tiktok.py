from __future__ import annotations

import json
import re
from typing import Optional, Tuple

from ..context import PlatformContext
from ..models import AccountStats
from ..utils import log_attempt_result, parse_compact_number

TIKTOK_SIGI_RE = re.compile(
    r"<script id=\"SIGI_STATE\">(.*?)</script>", re.DOTALL | re.IGNORECASE
)


def resolve(handle: str, context: PlatformContext) -> AccountStats:
    return _fetch_tiktok_scrape(handle, context)


def _fetch_tiktok_scrape(handle: str, context: PlatformContext) -> AccountStats:
    slug = handle.lstrip("@")
    url = f"https://www.tiktok.com/@{slug}"
    direct = context.request(url, "tiktok", handle, "direct")
    count, source = _parse_tiktok_html(
        direct.text or "", handle, "direct", url, context
    )
    log_attempt_result(
        context.logger,
        "tiktok",
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
        )
    proxy = context.fetch_text(url, "tiktok", handle)
    count, source = _parse_tiktok_html(
        proxy.text or "", handle, "text-proxy", url, context
    )
    log_attempt_result(
        context.logger,
        "tiktok",
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
) -> Tuple[Optional[int], str]:
    if not html:
        context.logger.info(
            "tiktok handle=%s attempt=%s url=%s parse=empty",
            handle,
            attempt,
            url,
        )
        return None, attempt
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
                                "tiktok handle=%s attempt=%s parse=SIGI_STATE-users count=%s",
                                handle,
                                attempt,
                                count,
                            )
                            return count, f"{attempt}:sigi-users"
            if isinstance(stats, dict):
                for key, entry in stats.items():
                    if not isinstance(entry, dict):
                        continue
                    count = entry.get("followerCount")
                    if isinstance(count, int):
                        context.logger.info(
                            "tiktok handle=%s attempt=%s parse=SIGI_STATE-stats count=%s",
                            handle,
                            attempt,
                            count,
                        )
                        return count, f"{attempt}:sigi-stats"
    regex_match = re.search(r'"followerCount"\s*:\s*([0-9]+)', html)
    if regex_match:
        count = int(regex_match.group(1))
        context.logger.info(
            "tiktok handle=%s attempt=%s parse=regex-json count=%s",
            handle,
            attempt,
            count,
        )
        return count, f"{attempt}:regex-json"
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
            return count, f"{attempt}:regex-text"
    context.logger.info(
        "tiktok handle=%s attempt=%s url=%s parse=miss",
        handle,
        attempt,
        url,
    )
    return None, attempt
