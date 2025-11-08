from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass
from html.parser import HTMLParser
from typing import Dict, Iterable, List, Optional, Tuple

from requests import RequestException

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
    r"(?i)([0-9][0-9.,\u00a0]*\s*[KMB]?)\s+views"
)


@dataclass
class YouTubeParseResult:
    subscribers: Optional[int] = None
    subscriber_source: Optional[str] = None
    views: Optional[int] = None
    views_source: Optional[str] = None
    video_count: Optional[int] = None
    video_source: Optional[str] = None
    notes: Optional[List[str]] = None

    def detail(self) -> Optional[str]:
        if not self.notes:
            return None
        seen: List[str] = []
        for note in self.notes:
            if note and note not in seen:
                seen.append(note)
        return " ".join(seen) if seen else None


class AdditionalInfoParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.rows: List[List[str]] = []
        self._in_container = False
        self._depth = 0
        self._in_td = False
        self._current_row: List[str] = []
        self._current_cell: List[str] = []

    def handle_starttag(self, tag: str, attrs: List[Tuple[str, Optional[str]]]) -> None:
        attrs_dict = {key: value for key, value in attrs}
        if not self._in_container:
            if tag == "div" and attrs_dict.get("id") == "additional-info-container":
                self._in_container = True
                self._depth = 1
            return
        self._depth += 1
        if tag == "tr":
            self._current_row = []
        elif tag == "td":
            self._in_td = True
            self._current_cell = []

    def handle_data(self, data: str) -> None:
        if self._in_container and self._in_td:
            self._current_cell.append(data)

    def handle_endtag(self, tag: str) -> None:
        if not self._in_container:
            return
        if tag == "td" and self._in_td:
            cell_text = "".join(self._current_cell).strip()
            self._current_row.append(cell_text)
            self._current_cell = []
            self._in_td = False
        elif tag == "tr":
            if self._current_row:
                self.rows.append(list(self._current_row))
            self._current_row = []
        self._depth -= 1
        if self._depth <= 0:
            self._in_container = False
            self._depth = 0


def resolve(handle: str, context: PlatformContext) -> AccountStats:
    scrape_result = _fetch_youtube_scrape(handle, context)
    api_key = os.environ.get("SOCIAL_YOUTUBE_API_KEY")
    if scrape_result.count is not None:
        return scrape_result
    if api_key:
        api_result = _fetch_youtube_api(handle, api_key, context)
        if api_result.count is not None:
            api_extra = api_result.extra if isinstance(api_result.extra, dict) else {}
            scrape_extra = (
                scrape_result.extra if isinstance(scrape_result.extra, dict) else {}
            )
            merged_extra: Dict[str, object] = dict(api_extra)
            for key, value in scrape_extra.items():
                if key not in merged_extra or merged_extra[key] is None:
                    merged_extra[key] = value
            if merged_extra:
                api_result = AccountStats(
                    handle=api_result.handle,
                    count=api_result.count,
                    fetched_at=api_result.fetched_at,
                    source=api_result.source,
                    is_mock=api_result.is_mock,
                    error=api_result.error,
                    from_cache=api_result.from_cache,
                    extra=merged_extra,
                )
            return api_result
    return scrape_result


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
                is_mock=True,
            )
        payload = response.json()
    except (RequestException, ValueError) as exc:
        context.logger.info(
            "youtube handle=%s attempt=api error=%s",
            handle,
            exc,
        )
        return AccountStats(
            handle=handle,
            count=None,
            fetched_at=context.now(),
            source="api",
            error=str(exc),
            is_mock=True,
        )
    statistics = (payload.get("items") or [{}])[0].get("statistics", {})
    count = statistics.get("subscriberCount")
    if count is not None:
        try:
            numeric = int(count)
        except (ValueError, TypeError):
            numeric = None
        if numeric is not None:
            context.logger.info(
                "youtube handle=%s attempt=api parse=statistics count=%s",
                handle,
                numeric,
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
        is_mock=True,
    )


def _youtube_candidate_urls(handle: str) -> List[str]:
    slug = handle.strip()
    urls: List[str] = []
    if slug.startswith("UC"):
        base = f"https://www.youtube.com/channel/{slug}"
        urls.extend(
            [
                f"{base}/about",
                base,
                f"{base}/about?hl=en&gl=US&persist_hl=1&persist_gl=1",
                f"{base}?hl=en&gl=US&persist_hl=1&persist_gl=1",
            ]
        )
    else:
        slug = slug.lstrip("@")
        base = f"https://www.youtube.com/@{slug}"
        urls.extend(
            [
                f"{base}/about",
                base,
                f"{base}/about?hl=en&gl=US&persist_hl=1&persist_gl=1",
                f"{base}?hl=en&gl=US&persist_hl=1&persist_gl=1",
            ]
        )
    seen: List[str] = []
    deduped: List[str] = []
    for candidate in urls:
        if candidate not in seen:
            seen.append(candidate)
            deduped.append(candidate)
    return deduped


def _fetch_youtube_scrape(handle: str, context: PlatformContext) -> AccountStats:
    best_views: Optional[int] = None
    best_video_count: Optional[int] = None
    last_error = "No subscriber data"
    for url in _youtube_candidate_urls(handle):
        for attempt in ("text-proxy", "direct"):
            outcome = context.request(url, "youtube", handle, attempt)
            html = (
                outcome.response.text
                if outcome.response is not None and outcome.response.ok
                else ""
            )
            parse_result, detail = _parse_youtube_html(html, attempt, url)
            parse_type = (
                "followers"
                if parse_result.subscribers is not None
                else ("views" if parse_result.views is not None else "miss")
            )
            detail_tokens: List[str] = []
            if detail:
                detail_tokens.append(detail)
            if parse_result.subscriber_source:
                detail_tokens.append(f"sub={parse_result.subscriber_source}")
            if parse_result.views_source:
                detail_tokens.append(f"views={parse_result.views_source}")
            if parse_result.video_source:
                detail_tokens.append(f"videos={parse_result.video_source}")
            context.log_attempt(
                "youtube",
                handle,
                outcome,
                parse_type,
                parse_result.subscribers,
                parse_result.views,
                " ".join(detail_tokens) if detail_tokens else None,
            )
            if parse_result.views is not None:
                best_views = parse_result.views
            if parse_result.video_count is not None:
                best_video_count = parse_result.video_count
            if parse_result.subscribers is not None:
                extra = {}
                if parse_result.views is not None:
                    extra["views"] = parse_result.views
                elif best_views is not None:
                    extra["views"] = best_views
                if parse_result.video_count is not None:
                    extra["video_count"] = parse_result.video_count
                elif best_video_count is not None:
                    extra["video_count"] = best_video_count
                return AccountStats(
                    handle=handle,
                    count=parse_result.subscribers,
                    fetched_at=context.now(),
                    source=f"scrape:{parse_result.subscriber_source or 'unknown'}",
                    extra=extra or None,
                )
            if outcome.response is None:
                last_error = outcome.error or "request error"
            elif not outcome.response.ok:
                last_error = f"HTTP {outcome.response.status_code}"
    extra: Dict[str, int] = {}
    if best_views is not None:
        extra["views"] = best_views
    if best_video_count is not None:
        extra["video_count"] = best_video_count
    return AccountStats(
        handle=handle,
        count=None,
        fetched_at=context.now(),
        source="scrape",
        error=last_error,
        is_mock=True,
        extra=extra or None,
    )


def _parse_youtube_html(
    html: str, attempt: str, url: str
) -> Tuple[YouTubeParseResult, Optional[str]]:
    result = YouTubeParseResult(notes=[])
    if not html:
        result.notes.append("empty-html")
        return result, "empty-html"
    data = extract_json_blob(html, YT_INITIAL_DATA_RE)
    if data:
        count = _search_for_subscriber_count(data)
        if count is not None:
            result.subscribers = count
            result.subscriber_source = "ytInitialData"
            result.notes.append("ytInitialData")
        else:
            result.notes.append("ytInitialData-miss")
    else:
        result.notes.append("ytInitialData-missing")
    if result.subscribers is None:
        player_data = extract_json_blob(html, YT_INITIAL_PLAYER_RE)
        if player_data:
            count = _search_for_subscriber_count(player_data)
            if count is not None:
                result.subscribers = count
                result.subscriber_source = "ytInitialPlayerResponse"
                result.notes.append("ytInitialPlayerResponse")
            else:
                result.notes.append("ytInitialPlayerResponse-miss")
        else:
            result.notes.append("ytInitialPlayerResponse-missing")
    if result.subscribers is None:
        found_cfg = False
        for match in YT_YTCFG_RE.finditer(html):
            found_cfg = True
            try:
                cfg = json.loads(match.group(1))
            except json.JSONDecodeError:
                continue
            count = _search_for_subscriber_count(cfg)
            if count is not None:
                result.subscribers = count
                result.subscriber_source = "ytcfg"
                result.notes.append("ytcfg")
                break
        if not found_cfg:
            result.notes.append("ytcfg-missing")
        elif result.subscribers is None:
            result.notes.append("ytcfg-miss")
    if result.subscribers is None:
        match = YT_SUBSCRIBERS_RE.search(html)
        if match:
            count = parse_compact_number(" ".join(match.groups()))
            if count is not None:
                result.subscribers = count
                result.subscriber_source = "regex-subscribers"
                result.notes.append("regex-subscribers")
            else:
                result.notes.append("regex-subscribers-miss")
        else:
            result.notes.append("regex-subscribers-missing")

    rows = _extract_additional_info_rows(html)
    views_from_dom = None
    if rows:
        views_from_dom = _extract_metric_from_rows(rows, {"view"}, allow_same_cell=True)
        if views_from_dom is not None:
            result.views = views_from_dom
            result.views_source = "additional-info"
            result.notes.append("views-additional-info")
        videos_from_dom = _extract_metric_from_rows(rows, {"video"}, allow_same_cell=True)
        if videos_from_dom is not None:
            result.video_count = videos_from_dom
            result.video_source = "additional-info"
            result.notes.append("videos-additional-info")
    if result.views is None:
        regex_match = YT_VIEWS_RE.search(html)
        if regex_match:
            parsed = _parse_view_token(regex_match.group(1))
            if parsed is not None:
                result.views = parsed
                result.views_source = "regex"
                result.notes.append("views-regex")
            else:
                result.notes.append("views-regex-miss")
        else:
            result.notes.append("views-regex-missing")
    if result.video_count is None:
        videos_match = YT_VIDEOS_RE.search(html)
        if videos_match:
            count = parse_compact_number(" ".join(videos_match.groups()))
            if count is not None:
                result.video_count = count
                result.video_source = "regex"
                result.notes.append("videos-regex")
            else:
                result.notes.append("videos-regex-miss")
        else:
            result.notes.append("videos-regex-missing")

    detail = result.detail()
    return result, detail


def _extract_additional_info_rows(html: str) -> List[List[str]]:
    parser = AdditionalInfoParser()
    try:
        parser.feed(html)
        parser.close()
    except Exception:
        return []
    normalized: List[List[str]] = []
    for row in parser.rows:
        cleaned = [" ".join(cell.split()) for cell in row if cell and cell.strip()]
        if cleaned:
            normalized.append(cleaned)
    return normalized


def _extract_metric_from_rows(
    rows: Iterable[List[str]],
    keywords: Iterable[str],
    *,
    allow_same_cell: bool,
) -> Optional[int]:
    keywords_lower = {keyword.lower() for keyword in keywords}
    for row in rows:
        lowered = [cell.lower() for cell in row]
        for idx, cell in enumerate(lowered):
            if any(keyword in cell for keyword in keywords_lower):
                if allow_same_cell:
                    parsed = _parse_view_token(row[idx])
                    if parsed is not None:
                        return parsed
                for jdx, other in enumerate(row):
                    if jdx == idx:
                        continue
                    parsed = _parse_view_token(other)
                    if parsed is not None:
                        return parsed
    return None


def _parse_view_token(token: str) -> Optional[int]:
    if not token:
        return None
    token = token.replace("\u00a0", " ").strip()
    if not token:
        return None
    compact = parse_compact_number(token)
    if compact is not None:
        return compact
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
