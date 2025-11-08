from __future__ import annotations

import json
import os
import re
import time
from typing import Dict, List, Optional, Tuple

from requests import RequestException, Response

from ..context import PlatformContext
from ..models import AccountStats
from ..settings import SCRAPER_TIMEOUT_SECONDS
from ..utils import extract_json_blob, parse_compact_number

YT_INITIAL_DATA_RE = re.compile(r"ytInitialData\s*=\s*(\{.+?\})\s*;", re.DOTALL)
YT_INITIAL_PLAYER_RE = re.compile(
    r"ytInitialPlayerResponse\s*=\s*(\{.+?\})\s*;", re.DOTALL
)
YT_YTCFG_RE = re.compile(r"ytcfg\.set\((\{.+?\})\);", re.DOTALL)
YT_SUBSCRIBERS_RE = re.compile(
    r"([0-9][0-9.,\u00a0]*)\s*([KMB]?)\s+subscribers", re.IGNORECASE
)
YT_VIDEOS_RE = re.compile(
    r"([0-9][0-9.,\u00a0]*)\s*([KMB]?)\s+videos", re.IGNORECASE
)
YT_VIEWS_RE = re.compile(
    r"([0-9][0-9.,\u00a0]*)\s*([KMB]?)\s+views", re.IGNORECASE
)


def resolve(handle: str, context: PlatformContext) -> AccountStats:
    api_key = os.environ.get("SOCIAL_YOUTUBE_API_KEY")
    if api_key:
        api_result = _fetch_youtube_api(handle, api_key, context)
        if api_result.count is not None:
            return api_result
    return _fetch_youtube_scrape(handle, context)


def _fetch_youtube_api(
    handle: str, api_key: str, context: PlatformContext
) -> AccountStats:
    params: Dict[str, str]
    if handle.startswith("UC"):
        params = {"part": "statistics", "id": handle, "key": api_key}
    else:
        params = {
            "part": "statistics",
            "forUsername": handle.lstrip("@"),
            "key": api_key,
        }
    url = "https://www.googleapis.com/youtube/v3/channels"
    start = time.perf_counter()
    try:
        response = context.session.get(
            url, params=params, timeout=SCRAPER_TIMEOUT_SECONDS
        )
        status = response.status_code
        context.logger.info(
            "youtube handle=%s attempt=api url=%s status=%s",
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
        elapsed = time.perf_counter() - start
        context.logger.info(
            "youtube handle=%s attempt=api error=%s elapsed=%.2fs",
            handle,
            exc,
            elapsed,
        )
        return AccountStats(
            handle=handle,
            count=None,
            fetched_at=context.now(),
            source="api",
            error=str(exc),
        )
    statistics = (payload.get("items") or [{}])[0].get("statistics", {})
    count = statistics.get("subscriberCount")
    if count is not None:
        try:
            numeric = int(count)
        except (ValueError, TypeError):
            numeric = None
        else:
            elapsed = time.perf_counter() - start
            context.logger.info(
                "youtube handle=%s attempt=api parse=statistics count=%s elapsed=%.2fs",
                handle,
                numeric,
                elapsed,
            )
            return AccountStats(
                handle=handle,
                count=numeric,
                fetched_at=context.now(),
                source="api",
            )
    return AccountStats(
        handle=handle,
        count=None,
        fetched_at=context.now(),
        source="api",
        error="Missing subscriber count",
    )


def _youtube_candidate_urls(handle: str) -> List[str]:
    slug = handle.strip()
    urls: List[str] = []
    if slug.startswith("UC"):
        urls.append(
            "https://www.youtube.com/channel/"
            f"{slug}/about?hl=en&gl=US&persist_hl=1&persist_gl=1"
        )
        urls.append(
            "https://www.youtube.com/channel/"
            f"{slug}?hl=en&gl=US&persist_hl=1&persist_gl=1"
        )
    else:
        slug = slug.lstrip("@")
        urls.append(
            "https://www.youtube.com/@"
            f"{slug}/about?hl=en&gl=US&persist_hl=1&persist_gl=1"
        )
        urls.append(
            "https://www.youtube.com/@"
            f"{slug}?hl=en&gl=US&persist_hl=1&persist_gl=1"
        )
    return urls


def _fetch_youtube_scrape(handle: str, context: PlatformContext) -> AccountStats:
    last_error = ""
    for url in _youtube_candidate_urls(handle):
        response = context.request(url, "youtube", handle, "direct")
        html = response.text if isinstance(response, Response) and response.ok else ""
        parse = _parse_youtube_html(html, handle, "direct", url, context)
        if parse is not None:
            return AccountStats(
                handle=handle,
                count=parse[0],
                fetched_at=context.now(),
                source=f"scrape:{parse[1]}",
            )
        if response is None or not isinstance(response, Response) or not response.ok or not html:
            last_error = (
                f"HTTP {response.status_code}" if isinstance(response, Response) else "request error"
            )
        proxy_html = context.fetch_text(url, "youtube", handle)
        parse = _parse_youtube_html(proxy_html or "", handle, "text-proxy", url, context)
        if parse is not None:
            return AccountStats(
                handle=handle,
                count=parse[0],
                fetched_at=context.now(),
                source=f"scrape:{parse[1]}",
            )
        last_error = "No subscriber pattern found"
    return AccountStats(
        handle=handle,
        count=None,
        fetched_at=context.now(),
        source="scrape",
        error=last_error or "No subscriber data",
    )


def _parse_youtube_html(
    html: str,
    handle: str,
    attempt: str,
    url: str,
    context: PlatformContext,
) -> Optional[Tuple[int, str]]:
    if not html:
        context.logger.info(
            "youtube handle=%s attempt=%s url=%s parse=empty-html",
            handle,
            attempt,
            url,
        )
        return None
    data = extract_json_blob(html, YT_INITIAL_DATA_RE)
    if data:
        count = _search_for_subscriber_count(data)
        if count is not None:
            context.logger.info(
                "youtube handle=%s attempt=%s parse=ytInitialData count=%s",
                handle,
                attempt,
                count,
            )
            _log_youtube_secondary_counts(html, handle, attempt, context)
            return count, f"{attempt}:ytInitialData"
        context.logger.info(
            "youtube handle=%s attempt=%s parse=ytInitialData-miss",
            handle,
            attempt,
        )
    else:
        context.logger.info(
            "youtube handle=%s attempt=%s parse=ytInitialData-missing",
            handle,
            attempt,
        )
    player_data = extract_json_blob(html, YT_INITIAL_PLAYER_RE)
    if player_data:
        count = _search_for_subscriber_count(player_data)
        if count is not None:
            context.logger.info(
                "youtube handle=%s attempt=%s parse=ytInitialPlayerResponse count=%s",
                handle,
                attempt,
                count,
            )
            _log_youtube_secondary_counts(html, handle, attempt, context)
            return count, f"{attempt}:ytInitialPlayerResponse"
        context.logger.info(
            "youtube handle=%s attempt=%s parse=ytInitialPlayerResponse-miss",
            handle,
            attempt,
        )
    found_cfg = False
    for match in YT_YTCFG_RE.finditer(html):
        found_cfg = True
        try:
            cfg = json.loads(match.group(1))
        except json.JSONDecodeError:
            continue
        count = _search_for_subscriber_count(cfg)
        if count is not None:
            context.logger.info(
                "youtube handle=%s attempt=%s parse=ytcfg count=%s",
                handle,
                attempt,
                count,
            )
            _log_youtube_secondary_counts(html, handle, attempt, context)
            return count, f"{attempt}:ytcfg"
    if not found_cfg:
        context.logger.info(
            "youtube handle=%s attempt=%s parse=ytcfg-missing",
            handle,
            attempt,
        )
    match = YT_SUBSCRIBERS_RE.search(html)
    if match:
        count = parse_compact_number(" ".join(match.groups()))
        if count is not None:
            context.logger.info(
                "youtube handle=%s attempt=%s parse=regex-subscribers count=%s",
                handle,
                attempt,
                count,
            )
            _log_youtube_secondary_counts(html, handle, attempt, context)
            return count, f"{attempt}:regex"
    else:
        context.logger.info(
            "youtube handle=%s attempt=%s parse=regex-subscribers-miss",
            handle,
            attempt,
        )
    _log_youtube_secondary_counts(html, handle, attempt, context)
    return None


def _log_youtube_secondary_counts(
    html: str, handle: str, attempt: str, context: PlatformContext
) -> None:
    videos_match = YT_VIDEOS_RE.search(html)
    if videos_match:
        videos = parse_compact_number(" ".join(videos_match.groups()))
        if videos is not None:
            context.logger.info(
                "youtube handle=%s attempt=%s parse=regex-videos count=%s",
                handle,
                attempt,
                videos,
            )
    views_match = YT_VIEWS_RE.search(html)
    if views_match:
        views = parse_compact_number(" ".join(views_match.groups()))
        if views is not None:
            context.logger.info(
                "youtube handle=%s attempt=%s parse=regex-views count=%s",
                handle,
                attempt,
                views,
            )


def _search_for_subscriber_count(node: object) -> Optional[int]:
    if node is None:
        return None
    if isinstance(node, dict):
        if "subscriberCountText" in node:
            value = node["subscriberCountText"]
            if isinstance(value, dict):
                if "simpleText" in value:
                    count = parse_compact_number(value["simpleText"])
                    if count is not None:
                        return count
                runs = value.get("runs")
                if isinstance(runs, list):
                    joined = " ".join(
                        str(part.get("text", "")) for part in runs if isinstance(part, dict)
                    )
                    count = parse_compact_number(joined)
                    if count is not None:
                        return count
            elif isinstance(value, str):
                count = parse_compact_number(value)
                if count is not None:
                    return count
        if "subscriberCount" in node:
            count = parse_compact_number(str(node["subscriberCount"]))
            if count is not None:
                return count
        for child in node.values():
            result = _search_for_subscriber_count(child)
            if result is not None:
                return result
    elif isinstance(node, list):
        for item in node:
            result = _search_for_subscriber_count(item)
            if result is not None:
                return result
    elif isinstance(node, str) and "subscriber" in node.lower():
        count = parse_compact_number(node)
        if count is not None:
            return count
    return None
