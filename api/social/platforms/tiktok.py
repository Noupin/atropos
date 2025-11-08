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
    for attempt in ("direct", "text-proxy"):
        outcome = context.request(url, "tiktok", handle, attempt)
        html = (
            outcome.response.text
            if outcome.response is not None and outcome.response.ok
            else ""
        )
        count, detail = _parse_tiktok_html(handle, html)
        parse_type = "followers" if count is not None else "miss"
        context.log_attempt(
            "tiktok",
            handle,
            outcome,
            parse_type,
            count,
            None,
            detail,
        )
        if count is not None:
            return AccountStats(
                handle=handle,
                count=count,
                fetched_at=context.now(),
                source=f"scrape:{detail or attempt}",
            )
    return AccountStats(
        handle=handle,
        count=None,
        fetched_at=context.now(),
        source="scrape",
        error="Missing follower count",
        is_mock=True,
    )


def _parse_tiktok_html(handle: str, html: str) -> Tuple[Optional[int], Optional[str]]:
    if not html:
        return None, "empty"
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
                            return count, "sigi-users"
            if isinstance(stats, dict):
                for key, entry in stats.items():
                    if not isinstance(entry, dict):
                        continue
                    count = entry.get("followerCount")
                    if isinstance(count, int):
                        return count, "sigi-stats"
    regex_match = re.search(r'"followerCount"\s*:\s*([0-9]+)', html)
    if regex_match:
        count = int(regex_match.group(1))
        return count, "regex-json"
    fallback_match = re.search(
        r"([0-9][0-9.,\u00a0]*)\s+Followers", html, re.IGNORECASE
    )
    if fallback_match:
        count = parse_compact_number(fallback_match.group(1))
        if count is not None:
            return count, "regex-text"
    return None, None
