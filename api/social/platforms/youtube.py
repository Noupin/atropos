from __future__ import annotations

import json
import os
import re
import time
from dataclasses import dataclass, replace
from html.parser import HTMLParser
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
YT_VIEWS_RE = re.compile(
    r"([0-9][0-9.,\u00a0]*)\s*([KMB]?)\s+views", re.IGNORECASE
)


@dataclass
class YoutubeParseResult:
    subscribers: Optional[int]
    views: Optional[int]
    count_source: Optional[str]
    views_source: Optional[str]


class _AdditionalInfoParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self._in_container = False
        self._container_depth = 0
        self._in_cell = False
        self._current_text: list[str] = []
        self.cells: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attrs_dict = {key: value for key, value in attrs}
        if tag.lower() == "div":
            if self._in_container:
                self._container_depth += 1
            elif attrs_dict.get("id") == "additional-info-container":
                self._in_container = True
                self._container_depth = 0
        if self._in_container and tag.lower() in {"td", "th"}:
            self._in_cell = True
            self._current_text = []

    def handle_endtag(self, tag: str) -> None:
        lower_tag = tag.lower()
        if lower_tag == "div" and self._in_container:
            if self._container_depth == 0:
                self._in_container = False
            else:
                self._container_depth -= 1
        if self._in_container and lower_tag in {"td", "th"} and self._in_cell:
            text = "".join(self._current_text).strip()
            if text:
                self.cells.append(text)
            self._in_cell = False
            self._current_text = []

    def handle_data(self, data: str) -> None:
        if self._in_container and self._in_cell:
            self._current_text.append(data)


def resolve(handle: str, context: PlatformContext) -> AccountStats:
    api_key = os.environ.get("SOCIAL_YOUTUBE_API_KEY")
    if api_key:
        api_result = _fetch_youtube_api(handle, api_key, context)
        if api_result.count is not None:
            views, views_source = _fetch_youtube_views_only(handle, context)
            if views is not None:
                extra = dict(api_result.extra or {})
                extra["views"] = views
                if views_source:
                    extra["views_source"] = views_source
                return replace(api_result, extra=extra)
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


def _fetch_youtube_views_only(
    handle: str, context: PlatformContext
) -> Tuple[Optional[int], Optional[str]]:
    last_source: Optional[str] = None
    for url in _youtube_candidate_urls(handle):
        response = context.request(url, "youtube", handle, "direct")
        html = response.text if isinstance(response, Response) and response.ok else ""
        views, source = _parse_youtube_views(html, handle, "direct", context)
        if views is not None:
            return views, source
        if source:
            last_source = source
        proxy_html = context.fetch_text(url, "youtube", handle) or ""
        views, source = _parse_youtube_views(proxy_html, handle, "text-proxy", context)
        if views is not None:
            return views, source
        if source:
            last_source = source
    return None, last_source


def _fetch_youtube_scrape(handle: str, context: PlatformContext) -> AccountStats:
    last_error = ""
    last_views: Optional[int] = None
    last_views_source: Optional[str] = None
    for url in _youtube_candidate_urls(handle):
        response = context.request(url, "youtube", handle, "direct")
        html = response.text if isinstance(response, Response) and response.ok else ""
        parse = _parse_youtube_html(html, handle, "direct", url, context)
        if parse is not None:
            if parse.views is not None:
                last_views = parse.views
                last_views_source = parse.views_source
            if parse.subscribers is not None:
                extra = {}
                if parse.views is not None:
                    extra["views"] = parse.views
                    if parse.views_source:
                        extra["views_source"] = parse.views_source
                return AccountStats(
                    handle=handle,
                    count=parse.subscribers,
                    fetched_at=context.now(),
                    source=f"scrape:{parse.count_source}" if parse.count_source else "scrape",
                    extra=extra or None,
                )
        if response is None or not isinstance(response, Response) or not response.ok or not html:
            last_error = (
                f"HTTP {response.status_code}" if isinstance(response, Response) else "request error"
            )
        proxy_html = context.fetch_text(url, "youtube", handle)
        parse = _parse_youtube_html(proxy_html or "", handle, "text-proxy", url, context)
        if parse is not None:
            if parse.views is not None:
                last_views = parse.views
                last_views_source = parse.views_source
            if parse.subscribers is not None:
                extra = {}
                if parse.views is not None:
                    extra["views"] = parse.views
                    if parse.views_source:
                        extra["views_source"] = parse.views_source
                return AccountStats(
                    handle=handle,
                    count=parse.subscribers,
                    fetched_at=context.now(),
                    source=f"scrape:{parse.count_source}" if parse.count_source else "scrape",
                    extra=extra or None,
                )
        last_error = "No subscriber pattern found"
    return AccountStats(
        handle=handle,
        count=None,
        fetched_at=context.now(),
        source="scrape",
        error=last_error or "No subscriber data",
        extra=
        {
            key: value
            for key, value in {
                "views": last_views,
                "views_source": last_views_source,
            }.items()
            if value is not None
        }
        or None,
    )


def _parse_youtube_html(
    html: str,
    handle: str,
    attempt: str,
    url: str,
    context: PlatformContext,
) -> Optional[YoutubeParseResult]:
    if not html:
        _log_youtube_parse(context, handle, attempt, "empty", None, None, False)
        return None

    views, views_source = _parse_youtube_views(html, handle, attempt, context)
    result = YoutubeParseResult(
        subscribers=None,
        views=views,
        count_source=None,
        views_source=views_source,
    )

    data = extract_json_blob(html, YT_INITIAL_DATA_RE)
    if data:
        count = _search_for_subscriber_count(data)
        success = count is not None
        _log_youtube_parse(
            context,
            handle,
            attempt,
            "ytInitialData",
            count,
            result.views,
            success,
        )
        if success:
            result.subscribers = count
            result.count_source = f"{attempt}:ytInitialData"
            return result
    else:
        _log_youtube_parse(
            context,
            handle,
            attempt,
            "ytInitialData-missing",
            None,
            result.views,
            False,
        )

    player_data = extract_json_blob(html, YT_INITIAL_PLAYER_RE)
    if player_data:
        count = _search_for_subscriber_count(player_data)
        success = count is not None
        _log_youtube_parse(
            context,
            handle,
            attempt,
            "ytInitialPlayerResponse",
            count,
            result.views,
            success,
        )
        if success:
            result.subscribers = count
            result.count_source = f"{attempt}:ytInitialPlayerResponse"
            return result
    else:
        _log_youtube_parse(
            context,
            handle,
            attempt,
            "ytInitialPlayerResponse-missing",
            None,
            result.views,
            False,
        )

    found_cfg = False
    for match in YT_YTCFG_RE.finditer(html):
        found_cfg = True
        try:
            cfg = json.loads(match.group(1))
        except json.JSONDecodeError:
            continue
        count = _search_for_subscriber_count(cfg)
        success = count is not None
        _log_youtube_parse(
            context,
            handle,
            attempt,
            "ytcfg",
            count,
            result.views,
            success,
        )
        if success:
            result.subscribers = count
            result.count_source = f"{attempt}:ytcfg"
            return result
    if not found_cfg:
        _log_youtube_parse(
            context,
            handle,
            attempt,
            "ytcfg-missing",
            None,
            result.views,
            False,
        )

    match = YT_SUBSCRIBERS_RE.search(html)
    if match:
        count = parse_compact_number(" ".join(match.groups()))
        success = count is not None
        _log_youtube_parse(
            context,
            handle,
            attempt,
            "regex-subscribers",
            count,
            result.views,
            success,
        )
        if success:
            result.subscribers = count
            result.count_source = f"{attempt}:regex"
            return result
    else:
        _log_youtube_parse(
            context,
            handle,
            attempt,
            "regex-subscribers-miss",
            None,
            result.views,
            False,
        )

    _log_youtube_parse(
        context,
        handle,
        attempt,
        "miss",
        None,
        result.views,
        False,
    )
    return result if result.views is not None else None


def _parse_youtube_views(
    html: str,
    handle: str,
    attempt: str,
    context: PlatformContext,
) -> Tuple[Optional[int], Optional[str]]:
    if not html:
        _log_youtube_parse(context, handle, attempt, "views-empty", None, None, False)
        return None, None

    parser = _AdditionalInfoParser()
    try:
        parser.feed(html)
        parser.close()
    except Exception:
        parser.cells = []

    for cell in parser.cells:
        if "view" not in cell.lower():
            continue
        views = _coerce_numeric(cell)
        success = views is not None
        _log_youtube_parse(
            context,
            handle,
            attempt,
            "additional-info",
            None,
            views,
            success,
        )
        if success:
            return views, f"{attempt}:additional-info"

    match = YT_VIEWS_RE.search(html)
    if match:
        views = _coerce_numeric(" ".join(match.groups()))
        success = views is not None
        _log_youtube_parse(
            context,
            handle,
            attempt,
            "regex-views",
            None,
            views,
            success,
        )
        if success:
            return views, f"{attempt}:regex-views"

    _log_youtube_parse(
        context,
        handle,
        attempt,
        "views-miss",
        None,
        None,
        False,
    )
    return None, None


def _log_youtube_parse(
    context: PlatformContext,
    handle: str,
    attempt: str,
    stage: str,
    subscribers: Optional[int],
    views: Optional[int],
    success: bool,
) -> None:
    context.logger.info(
        "youtube handle=%s source=%s stage=%s subscribers=%s views=%s success=%s",
        handle,
        attempt,
        stage,
        subscribers if subscribers is not None else "null",
        views if views is not None else "null",
        success,
    )


def _coerce_numeric(text: str) -> Optional[int]:
    digits = re.sub(r"[^0-9]", "", text)
    digits_value: Optional[int]
    if digits:
        try:
            digits_value = int(digits)
        except ValueError:
            digits_value = None
    else:
        digits_value = None
    numeric = parse_compact_number(text)
    if digits_value is not None:
        if numeric is None or digits_value > numeric:
            return digits_value
    return numeric


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
