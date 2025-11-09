from __future__ import annotations

import json
import os
import re
import time
from html.parser import HTMLParser
from typing import Dict, List, Optional, Tuple

from requests import RequestException, Response

from ..context import PlatformContext
from ..models import AccountStats
from ..settings import SCRAPER_TIMEOUT_SECONDS, TEXT_PROXY_PREFIX
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
YT_TOTAL_VIEWS_RE = re.compile(r"(?i)(\d[\d,\.]*)\s+views")


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
    extras: Dict[str, object] = {"views": None}
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
                extra=extras,
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
            extra=extras,
        )
    statistics = (payload.get("items") or [{}])[0].get("statistics", {})
    count = statistics.get("subscriberCount")
    views = _coerce_int(statistics.get("viewCount"))
    if views is not None or "views" not in extras:
        extras["views"] = views
    video_count = _coerce_int(statistics.get("videoCount"))
    if video_count is not None:
        extras["video_count"] = video_count
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
                extra=extras,
            )
    return AccountStats(
        handle=handle,
        count=None,
        fetched_at=context.now(),
        source="api",
        error="Missing subscriber count",
        extra=extras,
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
    video_count_snapshot: Optional[int] = None
    for url in _youtube_candidate_urls(handle):
        direct_start = time.perf_counter()
        response = context.request(url, "youtube", handle, "direct")
        status = response.status_code if isinstance(response, Response) else "error"
        html = response.text if isinstance(response, Response) and response.ok else ""
        views = _extract_youtube_views(
            html, handle, "direct", url, status, direct_start, context
        )
        if views is not None and views_snapshot is None:
            views_snapshot = views
        video_count = _extract_youtube_video_count(html, handle, "direct", context)
        if video_count is not None and video_count_snapshot is None:
            video_count_snapshot = video_count
        parse = _parse_youtube_html(html, handle, "direct", url, context)
        if parse is not None:
            extra = _build_youtube_extra(views_snapshot, video_count_snapshot)
            return AccountStats(
                handle=handle,
                count=parse[0],
                fetched_at=context.now(),
                source=f"scrape:{parse[1]}",
                extra=extra,
            )
        if response is None or not isinstance(response, Response) or not response.ok or not html:
            last_error = (
                f"HTTP {response.status_code}" if isinstance(response, Response) else "request error"
            )
        proxy_url = f"{TEXT_PROXY_PREFIX}{url}"
        proxy_start = time.perf_counter()
        proxy_response = context.request(proxy_url, "youtube", handle, "text-proxy")
        proxy_status = (
            proxy_response.status_code if isinstance(proxy_response, Response) else "error"
        )
        proxy_html = (
            proxy_response.text
            if isinstance(proxy_response, Response) and proxy_response.ok
            else ""
        )
        views = _extract_youtube_views(
            proxy_html, handle, "text-proxy", proxy_url, proxy_status, proxy_start, context
        )
        if views is not None and views_snapshot is None:
            views_snapshot = views
        video_count = _extract_youtube_video_count(proxy_html, handle, "text-proxy", context)
        if video_count is not None and video_count_snapshot is None:
            video_count_snapshot = video_count
        parse = _parse_youtube_html(proxy_html or "", handle, "text-proxy", url, context)
        if parse is not None:
            extra = _build_youtube_extra(views_snapshot, video_count_snapshot)
            return AccountStats(
                handle=handle,
                count=parse[0],
                fetched_at=context.now(),
                source=f"scrape:{parse[1]}",
                extra=extra,
            )
        last_error = "No subscriber pattern found"
    extra = _build_youtube_extra(views_snapshot, video_count_snapshot)
    return AccountStats(
        handle=handle,
        count=None,
        fetched_at=context.now(),
        source="scrape",
        error=last_error or "No subscriber data",
        extra=extra,
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
            return count, f"{attempt}:regex"
    else:
        context.logger.info(
            "youtube handle=%s attempt=%s parse=regex-subscribers-miss",
            handle,
            attempt,
        )
    return None


def _extract_youtube_views(
    html: str,
    handle: str,
    attempt: str,
    url: str,
    status: object,
    start: float,
    context: PlatformContext,
) -> Optional[int]:
    views: Optional[int] = None
    if html:
        views = _parse_views_from_dom(html)
        if views is None:
            views = _parse_views_from_regex(html)
    elapsed = time.perf_counter() - start
    context.logger.info(
        "platform=youtube handle=%s attempt=%s url=%s status=%s parse=%s views=%s elapsed=%.2fs",
        handle,
        attempt,
        url,
        status,
        "views" if views is not None else "miss",
        views if views is not None else "null",
        elapsed,
    )
    return views


def _parse_views_from_dom(html: str) -> Optional[int]:
    parser = _AdditionalInfoParser()
    try:
        parser.feed(html)
        parser.close()
    except Exception:  # noqa: BLE001
        return None
    for row in parser.rows:
        for index, cell in enumerate(row):
            value = _normalize_view_number(cell)
            if value is None:
                continue
            neighbors: List[str] = []
            if index > 0:
                neighbors.append(row[index - 1])
            if index + 1 < len(row):
                neighbors.append(row[index + 1])
            if any("views" in neighbor.lower() for neighbor in neighbors):
                return value
    return None


def _parse_views_from_regex(html: str) -> Optional[int]:
    match = YT_TOTAL_VIEWS_RE.search(html)
    if not match:
        return None
    return _normalize_view_number(match.group(1))


class _AdditionalInfoParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.rows: List[List[str]] = []
        self._container_depth = 0
        self._in_row = False
        self._in_td = False
        self._current_row: List[str] = []
        self._current_text: List[str] = []

    def handle_starttag(self, tag: str, attrs: List[Tuple[str, Optional[str]]]) -> None:
        attrs_dict = dict(attrs)
        if self._container_depth == 0:
            if tag == "div" and attrs_dict.get("id") == "additional-info-container":
                self._container_depth = 1
            else:
                return
        else:
            self._container_depth += 1
        if tag == "tr" and self._container_depth > 0:
            self._in_row = True
            self._current_row = []
        elif tag == "td" and self._in_row and not self._in_td:
            self._in_td = True
            self._current_text = []

    def handle_endtag(self, tag: str) -> None:
        if self._container_depth == 0:
            return
        if tag == "td" and self._in_td:
            text = "".join(self._current_text).strip()
            self._current_row.append(text)
            self._current_text = []
            self._in_td = False
        elif tag == "tr" and self._in_row:
            if self._current_row:
                self.rows.append(self._current_row)
            self._current_row = []
            self._in_row = False
        self._container_depth -= 1
        if self._container_depth == 0:
            self._in_td = False
            self._in_row = False
            self._current_row = []
            self._current_text = []

    def handle_data(self, data: str) -> None:
        if self._in_td:
            self._current_text.append(data)

    def handle_startendtag(self, tag: str, attrs: List[Tuple[str, Optional[str]]]) -> None:
        self.handle_starttag(tag, attrs)
        self.handle_endtag(tag)


def _normalize_view_number(text: str) -> Optional[int]:
    stripped = re.sub(r"(?i)views", "", text)
    digits = re.sub(r"[^0-9]", "", stripped)
    if not digits:
        return None
    try:
        return int(digits)
    except ValueError:
        return None


def _extract_youtube_video_count(
    html: str, handle: str, attempt: str, context: PlatformContext
) -> Optional[int]:
    if not html:
        return None
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
            return videos
    return None


def _build_youtube_extra(
    views: Optional[int], video_count: Optional[int]
) -> Dict[str, object]:
    extra: Dict[str, object] = {"views": views}
    if video_count is not None:
        extra["video_count"] = video_count
    return extra


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


def _coerce_int(value: object) -> Optional[int]:
    if isinstance(value, int):
        return value
    if isinstance(value, str):
        digits = re.sub(r"[^0-9]", "", value)
        if digits:
            try:
                return int(digits)
            except ValueError:
                return None
    return None
