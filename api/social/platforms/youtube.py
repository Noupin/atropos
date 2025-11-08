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
YT_VIDEOS_RE = re.compile(
    r"([0-9][0-9.,\u00a0]*)\s*([KMB]?)\s+videos", re.IGNORECASE
)


@dataclass
class YoutubeParseResult:
    subscribers: Optional[int]
    views: Optional[int]
    videos: Optional[int]
    count_source: Optional[str]
    views_source: Optional[str]
    videos_source: Optional[str]


class _AdditionalInfoParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self._in_container = False
        self._container_depth = 0
        self._in_row = False
        self._in_cell = False
        self._current_text: list[str] = []
        self._current_row: list[str] = []
        self.rows: list[list[str]] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attrs_dict = {key: value for key, value in attrs}
        if tag.lower() == "div":
            if self._in_container:
                self._container_depth += 1
            elif attrs_dict.get("id") == "additional-info-container":
                self._in_container = True
                self._container_depth = 0
        if self._in_container and tag.lower() == "tr":
            self._in_row = True
            self._current_row = []
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
        if self._in_container and lower_tag == "tr" and self._in_row:
            if self._current_row:
                self.rows.append(self._current_row)
            self._in_row = False
            self._current_row = []
        if self._in_container and lower_tag in {"td", "th"} and self._in_cell:
            text = "".join(self._current_text).strip()
            if text:
                self._current_row.append(text)
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
            views, views_source, videos, videos_source = _fetch_youtube_counts_only(
                handle, context
            )
            if views is not None or videos is not None:
                extra = dict(api_result.extra or {})
                if views is not None:
                    extra["views"] = views
                    if views_source:
                        extra["views_source"] = views_source
                if videos is not None:
                    extra["videos"] = videos
                    if videos_source:
                        extra["videos_source"] = videos_source
                return replace(api_result, extra=extra or None)
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


def _fetch_youtube_counts_only(
    handle: str, context: PlatformContext
) -> Tuple[Optional[int], Optional[str], Optional[int], Optional[str]]:
    last_view_source: Optional[str] = None
    last_video_source: Optional[str] = None
    last_videos: Optional[int] = None
    for url in _youtube_candidate_urls(handle):
        response = context.request(url, "youtube", handle, "direct", None)
        html = response.text if isinstance(response, Response) and response.ok else ""
        views, view_source, videos, video_source = _parse_additional_info_counts(
            html, handle, "direct", context
        )
        if views is None or videos is None:
            regex_views, regex_view_source, regex_videos, regex_video_source = (
                _parse_counts_from_regex(html, handle, "direct", context, views, videos)
            )
            if views is None and regex_views is not None:
                views = regex_views
                view_source = regex_view_source
            if videos is None and regex_videos is not None:
                videos = regex_videos
                video_source = regex_video_source
        if views is not None or videos is not None:
            return views, view_source, videos, video_source
        if view_source:
            last_view_source = view_source
        if video_source:
            last_video_source = video_source
        if videos is not None:
            last_videos = videos
        proxy_html = context.fetch_text(url, "youtube", handle) or ""
        views, view_source, videos, video_source = _parse_additional_info_counts(
            proxy_html, handle, "text-proxy", context
        )
        if views is None or videos is None:
            (
                regex_views,
                regex_view_source,
                regex_videos,
                regex_video_source,
            ) = _parse_counts_from_regex(
                proxy_html, handle, "text-proxy", context, views, videos
            )
            if views is None and regex_views is not None:
                views = regex_views
                view_source = regex_view_source
            if videos is None and regex_videos is not None:
                videos = regex_videos
                video_source = regex_video_source
        if views is not None or videos is not None:
            return views, view_source, videos, video_source
        if view_source:
            last_view_source = view_source
        if video_source:
            last_video_source = video_source
        if videos is not None:
            last_videos = videos
    return None, last_view_source, last_videos, last_video_source


def _fetch_youtube_scrape(handle: str, context: PlatformContext) -> AccountStats:
    last_error = ""
    last_views: Optional[int] = None
    last_views_source: Optional[str] = None
    last_videos: Optional[int] = None
    last_videos_source: Optional[str] = None
    for url in _youtube_candidate_urls(handle):
        response = context.request(url, "youtube", handle, "direct", None)
        html = response.text if isinstance(response, Response) and response.ok else ""
        parse = _parse_youtube_html(html, handle, "direct", url, context)
        if parse is not None:
            if parse.views is not None:
                last_views = parse.views
                last_views_source = parse.views_source
            if parse.videos is not None:
                last_videos = parse.videos
                last_videos_source = parse.videos_source
            if parse.subscribers is not None:
                extra = {}
                if parse.views is not None:
                    extra["views"] = parse.views
                    if parse.views_source:
                        extra["views_source"] = parse.views_source
                if parse.videos is not None:
                    extra["videos"] = parse.videos
                    if parse.videos_source:
                        extra["videos_source"] = parse.videos_source
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
            if parse.videos is not None:
                last_videos = parse.videos
                last_videos_source = parse.videos_source
            if parse.subscribers is not None:
                extra = {}
                if parse.views is not None:
                    extra["views"] = parse.views
                    if parse.views_source:
                        extra["views_source"] = parse.views_source
                if parse.videos is not None:
                    extra["videos"] = parse.videos
                    if parse.videos_source:
                        extra["videos_source"] = parse.videos_source
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
                "videos": last_videos,
                "videos_source": last_videos_source,
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
        _log_youtube_parse(context, handle, attempt, "empty", None, None, None, False)
        return None

    views, views_source, videos, videos_source = _parse_additional_info_counts(
        html, handle, attempt, context
    )
    result = YoutubeParseResult(
        subscribers=None,
        views=views,
        videos=videos,
        count_source=None,
        views_source=views_source,
        videos_source=videos_source,
    )

    data = extract_json_blob(html, YT_INITIAL_DATA_RE)
    if data:
        if result.views is None:
            view_count = _search_for_view_count(data)
            view_success = view_count is not None
            _log_youtube_parse(
                context,
                handle,
                attempt,
                "ytInitialData-views",
                None,
                view_count,
                result.videos,
                view_success,
            )
            if view_success:
                result.views = view_count
                result.views_source = f"{attempt}:ytInitialData"
        if result.videos is None:
            video_count = _search_for_video_count(data)
            video_success = video_count is not None
            _log_youtube_parse(
                context,
                handle,
                attempt,
                "ytInitialData-videos",
                None,
                result.views,
                video_count,
                video_success,
            )
            if video_success:
                result.videos = video_count
                result.videos_source = f"{attempt}:ytInitialData"
        count = _search_for_subscriber_count(data)
        success = count is not None
        _log_youtube_parse(
            context,
            handle,
            attempt,
            "ytInitialData",
            count,
            result.views,
            result.videos,
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
            result.videos,
            False,
        )

    player_data = extract_json_blob(html, YT_INITIAL_PLAYER_RE)
    if player_data:
        if result.views is None:
            view_count = _search_for_view_count(player_data)
            view_success = view_count is not None
            _log_youtube_parse(
                context,
                handle,
                attempt,
                "ytInitialPlayerResponse-views",
                None,
                view_count,
                result.videos,
                view_success,
            )
            if view_success:
                result.views = view_count
                result.views_source = f"{attempt}:ytInitialPlayerResponse"
        if result.videos is None:
            video_count = _search_for_video_count(player_data)
            video_success = video_count is not None
            _log_youtube_parse(
                context,
                handle,
                attempt,
                "ytInitialPlayerResponse-videos",
                None,
                result.views,
                video_count,
                video_success,
            )
            if video_success:
                result.videos = video_count
                result.videos_source = f"{attempt}:ytInitialPlayerResponse"
        count = _search_for_subscriber_count(player_data)
        success = count is not None
        _log_youtube_parse(
            context,
            handle,
            attempt,
            "ytInitialPlayerResponse",
            count,
            result.views,
            result.videos,
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
            result.videos,
            False,
        )

    found_cfg = False
    for match in YT_YTCFG_RE.finditer(html):
        found_cfg = True
        try:
            cfg = json.loads(match.group(1))
        except json.JSONDecodeError:
            continue
        if result.views is None:
            view_count = _search_for_view_count(cfg)
            view_success = view_count is not None
            _log_youtube_parse(
                context,
                handle,
                attempt,
                "ytcfg-views",
                None,
                view_count,
                result.videos,
                view_success,
            )
            if view_success:
                result.views = view_count
                result.views_source = f"{attempt}:ytcfg"
        if result.videos is None:
            video_count = _search_for_video_count(cfg)
            video_success = video_count is not None
            _log_youtube_parse(
                context,
                handle,
                attempt,
                "ytcfg-videos",
                None,
                result.views,
                video_count,
                video_success,
            )
            if video_success:
                result.videos = video_count
                result.videos_source = f"{attempt}:ytcfg"
        count = _search_for_subscriber_count(cfg)
        success = count is not None
        _log_youtube_parse(
            context,
            handle,
            attempt,
            "ytcfg",
            count,
            result.views,
            result.videos,
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
            result.videos,
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
            result.videos,
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
            result.videos,
            False,
        )

    if result.views is None or result.videos is None:
        regex_views, regex_view_source, regex_videos, regex_video_source = (
            _parse_counts_from_regex(
                html,
                handle,
                attempt,
                context,
                result.views,
                result.videos,
            )
        )
        if result.views is None and regex_views is not None:
            result.views = regex_views
            result.views_source = regex_view_source
        if result.videos is None and regex_videos is not None:
            result.videos = regex_videos
            result.videos_source = regex_video_source

    _log_youtube_parse(
        context,
        handle,
        attempt,
        "miss",
        None,
        result.views,
        result.videos,
        False,
    )
    if (
        result.views is not None
        or result.subscribers is not None
        or result.videos is not None
    ):
        return result
    return None


def _parse_additional_info_counts(
    html: str,
    handle: str,
    attempt: str,
    context: PlatformContext,
) -> Tuple[Optional[int], Optional[str], Optional[int], Optional[str]]:
    if not html:
        _log_youtube_parse(context, handle, attempt, "views-empty", None, None, None, False)
        _log_youtube_parse(context, handle, attempt, "videos-empty", None, None, None, False)
        return None, None, None, None

    parser = _AdditionalInfoParser()
    try:
        parser.feed(html)
        parser.close()
    except Exception:
        parser.rows = []

    views: Optional[int] = None
    videos: Optional[int] = None
    view_source: Optional[str] = None
    video_source: Optional[str] = None
    saw_view_candidate = False
    saw_video_candidate = False

    for row in parser.rows:
        for cell in row:
            normalized = cell.strip()
            if not normalized:
                continue
            lower = normalized.lower()
            if views is None and "view" in lower:
                saw_view_candidate = True
                match = YT_VIEWS_RE.search(normalized)
                candidate = " ".join(part for part in match.groups() if part) if match else normalized
                parsed = _coerce_numeric(candidate)
                success = parsed is not None
                _log_youtube_parse(
                    context,
                    handle,
                    attempt,
                    "additional-info-views",
                    None,
                    parsed,
                    videos,
                    success,
                )
                if success:
                    views = parsed
                    view_source = f"{attempt}:additional-info"
            if videos is None and "video" in lower:
                saw_video_candidate = True
                match_videos = YT_VIDEOS_RE.search(normalized)
                candidate_videos = (
                    " ".join(part for part in match_videos.groups() if part)
                    if match_videos
                    else normalized
                )
                parsed_videos = _coerce_numeric(candidate_videos)
                success_videos = parsed_videos is not None
                _log_youtube_parse(
                    context,
                    handle,
                    attempt,
                    "additional-info-videos",
                    None,
                    views,
                    parsed_videos,
                    success_videos,
                )
                if success_videos:
                    videos = parsed_videos
                    video_source = f"{attempt}:additional-info"
        if views is not None and videos is not None:
            break

    if views is None and not saw_view_candidate:
        _log_youtube_parse(
            context,
            handle,
            attempt,
            "additional-info-views-miss",
            None,
            None,
            videos,
            False,
        )
    if videos is None and not saw_video_candidate:
        _log_youtube_parse(
            context,
            handle,
            attempt,
            "additional-info-videos-miss",
            None,
            views,
            None,
            False,
        )
    return views, view_source, videos, video_source


def _parse_counts_from_regex(
    html: str,
    handle: str,
    attempt: str,
    context: PlatformContext,
    current_views: Optional[int],
    current_videos: Optional[int],
) -> Tuple[Optional[int], Optional[str], Optional[int], Optional[str]]:
    if not html:
        _log_youtube_parse(
            context,
            handle,
            attempt,
            "regex-empty",
            None,
            current_views,
            current_videos,
            False,
        )
        return None, None, None, None

    resolved_views: Optional[int] = None
    resolved_view_source: Optional[str] = None
    resolved_videos: Optional[int] = None
    resolved_video_source: Optional[str] = None
    view_match = YT_VIEWS_RE.search(html)
    if view_match:
        parsed = _coerce_numeric(" ".join(view_match.groups()))
        success = parsed is not None
        _log_youtube_parse(
            context,
            handle,
            attempt,
            "regex-views",
            None,
            parsed,
            current_videos,
            success,
        )
        if success:
            resolved_views = parsed
            resolved_view_source = f"{attempt}:regex-views"
            current_views = parsed
    else:
        _log_youtube_parse(
            context,
            handle,
            attempt,
            "regex-views-miss",
            None,
            current_views,
            current_videos,
            False,
        )

    video_match = YT_VIDEOS_RE.search(html)
    if video_match:
        parsed_videos = _coerce_numeric(" ".join(video_match.groups()))
        success_videos = parsed_videos is not None
        _log_youtube_parse(
            context,
            handle,
            attempt,
            "regex-videos",
            None,
            current_views,
            parsed_videos,
            success_videos,
        )
        if success_videos:
            resolved_videos = parsed_videos
            resolved_video_source = f"{attempt}:regex-videos"
    else:
        _log_youtube_parse(
            context,
            handle,
            attempt,
            "regex-videos-miss",
            None,
            current_views,
            current_videos,
            False,
        )

    return resolved_views, resolved_view_source, resolved_videos, resolved_video_source


def _log_youtube_parse(
    context: PlatformContext,
    handle: str,
    attempt: str,
    stage: str,
    subscribers: Optional[int],
    views: Optional[int],
    videos: Optional[int],
    success: bool,
) -> None:
    context.logger.info(
        (
            "youtube handle=%s source=%s stage=%s subscribers=%s views=%s "
            "videos=%s success=%s"
        ),
        handle,
        attempt,
        stage,
        subscribers if subscribers is not None else "null",
        views if views is not None else "null",
        videos if videos is not None else "null",
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


def _search_for_view_count(node: object) -> Optional[int]:
    if node is None:
        return None
    if isinstance(node, dict):
        if "viewCountText" in node:
            value = node["viewCountText"]
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
        for key in ("viewCount", "totalViewCount"):
            if key in node:
                raw_value = node[key]
                if isinstance(raw_value, dict):
                    simple = raw_value.get("simpleText")
                    if isinstance(simple, str):
                        count = parse_compact_number(simple)
                        if count is not None:
                            return count
                    runs = raw_value.get("runs")
                    if isinstance(runs, list):
                        joined = " ".join(
                            str(part.get("text", ""))
                            for part in runs
                            if isinstance(part, dict)
                        )
                        count = parse_compact_number(joined)
                        if count is not None:
                            return count
                elif isinstance(raw_value, (int, float)):
                    numeric = int(raw_value)
                    if numeric >= 0:
                        return numeric
                elif isinstance(raw_value, str):
                    count = parse_compact_number(raw_value)
                    if count is not None:
                        return count
        for child in node.values():
            result = _search_for_view_count(child)
            if result is not None:
                return result
    elif isinstance(node, list):
        for item in node:
            result = _search_for_view_count(item)
            if result is not None:
                return result
    elif isinstance(node, str) and "view" in node.lower():
        count = parse_compact_number(node)
        if count is not None:
            return count
    return None


def _search_for_video_count(node: object) -> Optional[int]:
    if node is None:
        return None
    if isinstance(node, dict):
        for key in ("videoCountText", "videosCountText"):
            if key in node:
                value = node[key]
                if isinstance(value, dict):
                    simple = value.get("simpleText")
                    if isinstance(simple, str):
                        count = parse_compact_number(simple)
                        if count is not None:
                            return count
                    runs = value.get("runs")
                    if isinstance(runs, list):
                        joined = " ".join(
                            str(part.get("text", ""))
                            for part in runs
                            if isinstance(part, dict)
                        )
                        count = parse_compact_number(joined)
                        if count is not None:
                            return count
                elif isinstance(value, str):
                    count = parse_compact_number(value)
                    if count is not None:
                        return count
        for key in ("videoCount", "videosCount"):
            if key in node:
                raw_value = node[key]
                if isinstance(raw_value, dict):
                    simple = raw_value.get("simpleText")
                    if isinstance(simple, str):
                        count = parse_compact_number(simple)
                        if count is not None:
                            return count
                    runs = raw_value.get("runs")
                    if isinstance(runs, list):
                        joined = " ".join(
                            str(part.get("text", ""))
                            for part in runs
                            if isinstance(part, dict)
                        )
                        count = parse_compact_number(joined)
                        if count is not None:
                            return count
                elif isinstance(raw_value, (int, float)):
                    numeric = int(raw_value)
                    if numeric >= 0:
                        return numeric
                elif isinstance(raw_value, str):
                    count = parse_compact_number(raw_value)
                    if count is not None:
                        return count
        for child in node.values():
            result = _search_for_video_count(child)
            if result is not None:
                return result
    elif isinstance(node, list):
        for item in node:
            result = _search_for_video_count(item)
            if result is not None:
                return result
    elif isinstance(node, str) and "video" in node.lower():
        count = parse_compact_number(node)
        if count is not None:
            return count
    return None
