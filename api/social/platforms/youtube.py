from __future__ import annotations

import json
import os
import re
import time
from dataclasses import dataclass, replace
from html import unescape
from typing import Dict, List, Optional, Tuple

from requests import RequestException, Response

from ..context import PlatformContext
from ..models import AccountStats
from ..settings import SCRAPER_TIMEOUT_SECONDS
from ..utils import extract_json_blob, log_scrape_attempt, parse_compact_number

YT_INITIAL_DATA_RE = re.compile(r"ytInitialData\s*=\s*(\{.+?\})\s*;", re.DOTALL)
YT_INITIAL_PLAYER_RE = re.compile(
    r"ytInitialPlayerResponse\s*=\s*(\{.+?\})\s*;", re.DOTALL
)
YT_YTCFG_RE = re.compile(r"ytcfg\.set\((\{.+?\})\);", re.DOTALL)
YT_SUBSCRIBERS_RE = re.compile(
    r"([0-9][0-9.,\u00a0]*)\s*([KMB]?)\s+subscribers", re.IGNORECASE
)
YT_ADDITIONAL_INFO_RE = re.compile(
    r'<div[^>]+id="additional-info-container"[^>]*>(.*?)</div>',
    re.DOTALL | re.IGNORECASE,
)
YT_TABLE_CELL_RE = re.compile(r"<td[^>]*>(.*?)</td>", re.DOTALL | re.IGNORECASE)
YT_VIEWS_CELL_RE = re.compile(r"([\d.,\u00a0]+)\s+views", re.IGNORECASE)
YT_PAGE_VIEWS_RE = re.compile(r"(\d[\d.,\u00a0]*)\s+views", re.IGNORECASE)


@dataclass
class YouTubeParseResult:
    count: Optional[int]
    views: Optional[int]
    detail: str
    success: bool


def resolve(handle: str, context: PlatformContext) -> AccountStats:
    scrape_result = _fetch_youtube_scrape(handle, context)
    scrape_views: Optional[int] = None
    if isinstance(scrape_result.extra, dict):
        views_value = scrape_result.extra.get("views")
        if isinstance(views_value, int):
            scrape_views = views_value
    cleaned_scrape = scrape_result
    if scrape_result.count is None and scrape_result.extra:
        cleaned_scrape = replace(scrape_result, extra=None)

    api_key = os.environ.get("SOCIAL_YOUTUBE_API_KEY")
    if api_key:
        api_result = _fetch_youtube_api(handle, api_key, context)
        if api_result.count is not None:
            merged_extra: Dict[str, object] = (
                dict(api_result.extra) if isinstance(api_result.extra, dict) else {}
            )
            if scrape_views is not None:
                merged_extra["views"] = scrape_views
            return replace(api_result, extra=merged_extra or None)
        if cleaned_scrape.count is not None:
            return cleaned_scrape
        return replace(api_result, extra=None)
    return cleaned_scrape


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
    views_snapshot: Optional[int] = None
    for url in _youtube_candidate_urls(handle):
        response = context.request(url, "youtube", handle, "direct")
        html = response.text if isinstance(response, Response) and response.ok else ""
        result = _parse_youtube_html(html)
        if isinstance(result.views, int):
            views_snapshot = result.views
        log_scrape_attempt(
            context.logger,
            "youtube",
            handle,
            "direct",
            result.detail,
            result.count,
            result.views,
            result.success,
        )
        if result.count is not None:
            view_value = result.views if isinstance(result.views, int) else views_snapshot
            extra = {"views": view_value} if isinstance(view_value, int) else None
            return AccountStats(
                handle=handle,
                count=result.count,
                fetched_at=context.now(),
                source=f"scrape:direct:{result.detail}",
                extra=extra,
            )
        if response is None or not isinstance(response, Response) or not response.ok:
            last_error = (
                f"HTTP {response.status_code}" if isinstance(response, Response) else "request error"
            )
        proxy_html = context.fetch_text(url, "youtube", handle) or ""
        proxy_result = _parse_youtube_html(proxy_html)
        if isinstance(proxy_result.views, int) and views_snapshot is None:
            views_snapshot = proxy_result.views
        log_scrape_attempt(
            context.logger,
            "youtube",
            handle,
            "text-proxy",
            proxy_result.detail,
            proxy_result.count,
            proxy_result.views,
            proxy_result.success,
        )
        if proxy_result.count is not None:
            view_value = (
                proxy_result.views
                if isinstance(proxy_result.views, int)
                else views_snapshot
            )
            extra = {"views": view_value} if isinstance(view_value, int) else None
            return AccountStats(
                handle=handle,
                count=proxy_result.count,
                fetched_at=context.now(),
                source=f"scrape:text-proxy:{proxy_result.detail}",
                extra=extra,
            )
        last_error = "No subscriber pattern found"
    extra = {"views": views_snapshot} if isinstance(views_snapshot, int) else None
    return AccountStats(
        handle=handle,
        count=None,
        fetched_at=context.now(),
        source="scrape",
        error=last_error or "No subscriber data",
        extra=extra,
    )


def _parse_youtube_html(html: str) -> YouTubeParseResult:
    if not html:
        return YouTubeParseResult(None, None, "empty-html", False)

    details: List[str] = []
    count: Optional[int] = None
    count_detail: Optional[str] = None

    data = extract_json_blob(html, YT_INITIAL_DATA_RE)
    if data:
        candidate = _search_for_subscriber_count(data)
        if candidate is not None:
            count = candidate
            count_detail = "ytInitialData"
        else:
            details.append("ytInitialData-miss")
    else:
        details.append("ytInitialData-missing")

    if count is None:
        player_data = extract_json_blob(html, YT_INITIAL_PLAYER_RE)
        if player_data:
            candidate = _search_for_subscriber_count(player_data)
            if candidate is not None:
                count = candidate
                count_detail = "ytInitialPlayerResponse"
            else:
                details.append("ytInitialPlayerResponse-miss")
        else:
            details.append("ytInitialPlayerResponse-missing")

    if count is None:
        found_cfg = False
        for match in YT_YTCFG_RE.finditer(html):
            found_cfg = True
            try:
                cfg = json.loads(match.group(1))
            except json.JSONDecodeError:
                continue
            candidate = _search_for_subscriber_count(cfg)
            if candidate is not None:
                count = candidate
                count_detail = "ytcfg"
                break
        if not found_cfg:
            details.append("ytcfg-missing")
        elif count is None:
            details.append("ytcfg-miss")

    if count is None:
        match = YT_SUBSCRIBERS_RE.search(html)
        if match:
            candidate = parse_compact_number(" ".join(match.groups()))
            if candidate is not None:
                count = candidate
                count_detail = "regex-subscribers"
            else:
                details.append("regex-subscribers-miss")
        else:
            details.append("regex-subscribers-missing")

    if count_detail:
        details.append(count_detail)

    views, views_detail = _extract_youtube_views(html)
    if views_detail:
        details.append(views_detail)

    detail = "|".join(details) if details else (count_detail or "miss")
    return YouTubeParseResult(count, views, detail, count is not None)


def _extract_youtube_views(html: str) -> Tuple[Optional[int], str]:
    if not html:
        return None, "views-miss"

    container = YT_ADDITIONAL_INFO_RE.search(html)
    if container:
        segment = container.group(1)
        for cell_html in YT_TABLE_CELL_RE.findall(segment):
            text = _strip_html(cell_html)
            if not text:
                continue
            match = YT_VIEWS_CELL_RE.search(text)
            if match:
                value = _parse_views_token(match.group(1))
                if value is not None:
                    return value, "views-table"

    normalized = _strip_html(html)
    match = YT_PAGE_VIEWS_RE.search(normalized)
    if match:
        value = _parse_views_token(match.group(1))
        if value is not None:
            return value, "views-regex"

    return None, "views-miss"


def _strip_html(content: str) -> str:
    if not content:
        return ""
    stripped = re.sub(r"<[^>]+>", " ", content)
    return re.sub(r"\s+", " ", unescape(stripped)).strip()


def _parse_views_token(token: str) -> Optional[int]:
    if not token:
        return None
    digits = re.sub(r"[^0-9]", "", token)
    if digits:
        try:
            return int(digits)
        except ValueError:
            return None
    return None


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
