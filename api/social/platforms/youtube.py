from __future__ import annotations

import json
import os
import re
import time
from html import unescape
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
YT_ABOUT_INFO_CONTAINER_RE = re.compile(
    r'id=["\']additional-info-container["\']', re.IGNORECASE
)
YT_ABOUT_ROW_RE = re.compile(r"<tr[^>]*>(.*?)</tr>", re.IGNORECASE | re.DOTALL)
YT_ABOUT_CELL_RE = re.compile(r"<td[^>]*>(.*?)</td>", re.IGNORECASE | re.DOTALL)
YT_ABOUT_VIEWS_FALLBACK_RE = re.compile(r"(?i)(\d[\d,.]*)\s+views")


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
        "youtube handle=%s attempt=%s status=%s followers=%s views=%s source=%s",
        handle,
        attempt,
        status if status is not None else "error",
        followers if followers is not None else "null",
        views if views is not None else "null",
        source,
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
            _log_attempt(context, handle, "api", status, None, None, "api:http-error")
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
        _log_attempt(context, handle, "api", None, None, None, "api:error")
        return AccountStats(
            handle=handle,
            count=None,
            fetched_at=context.now(),
            source="api",
            error=str(exc),
        )
    statistics = (payload.get("items") or [{}])[0].get("statistics", {})
    count = statistics.get("subscriberCount")
    numeric = None
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
    extra: Dict[str, int] = {}
    view_count = statistics.get("viewCount")
    if view_count is not None:
        try:
            views_numeric = int(view_count)
        except (ValueError, TypeError):
            views_numeric = None
        else:
            extra["views"] = views_numeric
    video_count = statistics.get("videoCount")
    if video_count is not None:
        try:
            videos_numeric = int(video_count)
        except (ValueError, TypeError):
            videos_numeric = None
        else:
            extra["videos"] = videos_numeric
    if numeric is not None:
        _log_attempt(
            context,
            handle,
            "api",
            status,
            numeric,
            extra.get("views"),
            "api:statistics",
        )
        return AccountStats(
            handle=handle,
            count=numeric,
            fetched_at=context.now(),
            source="api",
            extra=extra or None,
        )
    _log_attempt(context, handle, "api", status, None, extra.get("views"), "api:missing")
    return AccountStats(
        handle=handle,
        count=None,
        fetched_at=context.now(),
        source="api",
        error="Missing subscriber count",
        extra=extra or None,
    )


def _youtube_candidate_urls(handle: str) -> List[str]:
    slug = handle.strip()
    if slug.startswith("UC"):
        base = f"https://www.youtube.com/channel/{slug}"
    else:
        base = f"https://www.youtube.com/@{slug.lstrip('@')}"
    query = "?hl=en&gl=US&persist_hl=1&persist_gl=1"
    return [f"{base}/about{query}", f"{base}{query}"]


def _fetch_youtube_scrape(handle: str, context: PlatformContext) -> AccountStats:
    last_error = ""
    captured_views: Optional[int] = None
    for url in _youtube_candidate_urls(handle):
        response = context.request(url, "youtube", handle, "direct")
        status = response.status_code if isinstance(response, Response) else None
        html = response.text if isinstance(response, Response) and response.ok else ""
        count, source, extra = _parse_youtube_html(html, handle, "direct", url, context)
        views = (extra or {}).get("views") if extra else None
        if views is not None and captured_views is None:
            captured_views = views
        _log_attempt(context, handle, "direct", status, count, views, source)
        if count is not None:
            final_extra = dict(extra or {})
            if captured_views is not None and "views" not in final_extra:
                final_extra["views"] = captured_views
            return AccountStats(
                handle=handle,
                count=count,
                fetched_at=context.now(),
                source=f"scrape:{source}",
                extra=final_extra or None,
            )
        if response is None or not isinstance(response, Response) or not response.ok or not html:
            last_error = (
                f"HTTP {response.status_code}" if isinstance(response, Response) else "request error"
            )
        proxy_html = context.fetch_text(url, "youtube", handle)
        count, source, extra = _parse_youtube_html(
            proxy_html or "", handle, "text-proxy", url, context
        )
        views = (extra or {}).get("views") if extra else None
        if views is not None and captured_views is None:
            captured_views = views
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
            final_extra = dict(extra or {})
            if captured_views is not None and "views" not in final_extra:
                final_extra["views"] = captured_views
            return AccountStats(
                handle=handle,
                count=count,
                fetched_at=context.now(),
                source=f"scrape:{source}",
                extra=final_extra or None,
            )
        last_error = "No subscriber pattern found"
    _log_attempt(context, handle, "scrape", None, None, None, "scrape:miss")
    return AccountStats(
        handle=handle,
        count=None,
        fetched_at=context.now(),
        source="scrape",
        error=last_error or "No subscriber data",
        is_mock=True,
    )


def _parse_youtube_html(
    html: str,
    handle: str,
    attempt: str,
    url: str,
    context: PlatformContext,
) -> Tuple[Optional[int], str, Optional[Dict[str, int]]]:
    if not html:
        context.logger.info(
            "youtube handle=%s attempt=%s url=%s parse=empty-html",
            handle,
            attempt,
            url,
        )
        if "/about" in url:
            _extract_about_views("", handle, attempt, url, context)
        return None, f"{attempt}:empty-html", None
    secondary = _extract_secondary_counts(html, handle, attempt, context)
    about_views = _extract_about_views(html, handle, attempt, url, context)
    if about_views is not None:
        secondary = dict(secondary) if secondary else {}
        secondary["views"] = about_views
    data = extract_json_blob(html, YT_INITIAL_DATA_RE)
    if data:
        secondary = _augment_secondary_counts_from_initial_data(
            data, handle, attempt, context, secondary
        )
        count = _search_for_subscriber_count(data)
        if count is not None:
            context.logger.info(
                "youtube handle=%s attempt=%s parse=ytInitialData count=%s",
                handle,
                attempt,
                count,
            )
            return count, f"{attempt}:ytInitialData", secondary
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
        secondary = _augment_secondary_counts_from_initial_data(
            player_data, handle, attempt, context, secondary
        )
        count = _search_for_subscriber_count(player_data)
        if count is not None:
            context.logger.info(
                "youtube handle=%s attempt=%s parse=ytInitialPlayerResponse count=%s",
                handle,
                attempt,
                count,
            )
            return count, f"{attempt}:ytInitialPlayerResponse", secondary
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
            return count, f"{attempt}:ytcfg", secondary
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
            return count, f"{attempt}:regex", secondary
    else:
        context.logger.info(
            "youtube handle=%s attempt=%s parse=regex-subscribers-miss",
            handle,
            attempt,
        )
    return None, f"{attempt}:miss", secondary


def _extract_secondary_counts(
    html: str, handle: str, attempt: str, context: PlatformContext
) -> Optional[Dict[str, int]]:
    result: Dict[str, int] = {}
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
            result["videos"] = videos
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
            result["views"] = views
    return result or None


def _extract_about_views(
    html: str,
    handle: str,
    attempt: str,
    url: str,
    context: PlatformContext,
) -> Optional[int]:
    if "/about" not in url:
        return None
    views = _extract_about_table_views(html)
    origin = "table"
    if views is None:
        match = YT_ABOUT_VIEWS_FALLBACK_RE.search(html)
        if match:
            views = _normalize_view_total(match.group(1))
            origin = "regex"
    if views is not None:
        context.logger.info(
            "youtube handle=%s attempt=%s parse=views count=%s origin=%s",
            handle,
            attempt,
            views,
            origin,
        )
        return views
    context.logger.info(
        "youtube handle=%s attempt=%s parse=miss",
        handle,
        attempt,
    )
    return None


def _extract_about_table_views(html: str) -> Optional[int]:
    container_match = YT_ABOUT_INFO_CONTAINER_RE.search(html)
    if not container_match:
        return None
    table_start = html.find("<table", container_match.end())
    if table_start == -1:
        return None
    table_end = html.find("</table>", table_start)
    if table_end == -1:
        return None
    table_html = html[table_start : table_end + len("</table>")]
    for row_match in YT_ABOUT_ROW_RE.finditer(table_html):
        cells = [
            _normalize_cell_text(cell)
            for cell in YT_ABOUT_CELL_RE.findall(row_match.group(1))
        ]
        if not cells:
            continue
        for index, cell in enumerate(cells):
            if "views" in cell.lower():
                number = _normalize_view_total(cell)
                if number is not None:
                    return number
                previous = cells[index - 1] if index > 0 else ""
                number = _normalize_view_total(previous)
                if number is not None:
                    return number
        if len(cells) >= 2:
            number = _normalize_view_total(cells[0])
            if number is not None and "views" in cells[1].lower():
                return number
    return None


def _normalize_cell_text(cell: str) -> str:
    text = re.sub(r"<[^>]+>", " ", cell)
    text = unescape(text)
    text = text.replace("\u00a0", " ")
    return re.sub(r"\s+", " ", text).strip()


def _normalize_view_total(raw: str) -> Optional[int]:
    cleaned = raw.replace(",", "").replace(".", "").replace("\u00a0", "")
    cleaned = re.sub(r"\s+", "", cleaned)
    if not cleaned:
        return None
    if not cleaned.isdigit():
        match = re.search(r"(\d+)", cleaned)
        cleaned = match.group(1) if match else ""
    return int(cleaned) if cleaned.isdigit() else None


def _augment_secondary_counts_from_initial_data(
    data: object,
    handle: str,
    attempt: str,
    context: PlatformContext,
    secondary: Optional[Dict[str, int]],
) -> Optional[Dict[str, int]]:
    extras = dict(secondary) if secondary else {}
    views = _search_for_view_count(data)
    if views is not None and "views" not in extras:
        context.logger.info(
            "youtube handle=%s attempt=%s parse=json-views count=%s",
            handle,
            attempt,
            views,
        )
        extras["views"] = views
    if not extras:
        return None
    return extras


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
            text = _coerce_text(node["viewCountText"])
            if text:
                count = parse_compact_number(text)
                if count is not None:
                    return count
        if "viewCount" in node:
            count = parse_compact_number(str(node["viewCount"]))
            if count is not None:
                return count
        for value in node.values():
            nested = _search_for_view_count(value)
            if nested is not None:
                return nested
    elif isinstance(node, list):
        for item in node:
            nested = _search_for_view_count(item)
            if nested is not None:
                return nested
    return None


def _coerce_text(value: object) -> str:
    if isinstance(value, str):
        return value
    if isinstance(value, dict):
        simple = value.get("simpleText")
        if isinstance(simple, str):
            return simple
        runs = value.get("runs")
        if isinstance(runs, list):
            parts: List[str] = []
            for item in runs:
                if isinstance(item, dict):
                    text = item.get("text")
                    if isinstance(text, str):
                        parts.append(text)
            if parts:
                return "".join(parts)
    if isinstance(value, list):
        parts = [
            fragment
            for fragment in (_coerce_text(item) for item in value)
            if fragment
        ]
        if parts:
            return "".join(parts)
    return ""
