"""Robust social metrics fetching and caching helpers."""
from __future__ import annotations

import json
import logging
import os
import re
import time
from dataclasses import dataclass, replace
from datetime import datetime, timezone
from html import unescape
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Tuple

import requests
from requests import Response, Session
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

logger = logging.getLogger(__name__)

SUPPORTED_PLATFORMS = {"youtube", "instagram", "tiktok", "facebook"}
SCRAPER_TIMEOUT_SECONDS = float(os.environ.get("SCRAPER_TIMEOUT_SECONDS", "6"))
SCRAPER_RETRIES = int(os.environ.get("SCRAPER_RETRIES", "2"))
DEFAULT_CACHE_SECONDS = int(os.environ.get("SOCIAL_CACHE_SECONDS", "900"))
TEXT_PROXY_PREFIX = "https://r.jina.ai/"
INSTAGRAM_WEB_APP_ID = os.environ.get(
    "INSTAGRAM_WEB_APP_ID", "936619743392459"
)

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
TIKTOK_SIGI_RE = re.compile(
    r"<script id=\"SIGI_STATE\">(.*?)</script>", re.DOTALL | re.IGNORECASE
)
INSTAGRAM_LD_JSON_RE = re.compile(
    r"<script type=\"application/ld\+json\">(\{.*?\})</script>",
    re.DOTALL | re.IGNORECASE,
)
FACEBOOK_FOLLOW_RE = re.compile(
    r"([0-9][0-9.,\u00a0]*\s*[KMB]?)\s+(?:people\s+)?follow this",
    re.IGNORECASE,
)
FACEBOOK_FOLLOWERS_RE = re.compile(
    r"([0-9][0-9.,\u00a0]*\s*[KMB]?)\s+followers",
    re.IGNORECASE,
)
FACEBOOK_ARIA_LABEL_RE = re.compile(
    r'aria-label=["\']([0-9][0-9.,\u00a0]*\s*[KMB]?)\s+followers["\']',
    re.IGNORECASE,
)
FACEBOOK_JSON_RE = re.compile(r'"fan_count"\s*:\s*([0-9]+)')


class UnsupportedPlatformError(ValueError):
    """Raised when the caller requests an unsupported platform."""


@dataclass
class AccountStats:
    handle: str
    count: Optional[int]
    fetched_at: float
    source: str
    is_mock: bool = False
    error: Optional[str] = None
    from_cache: bool = False

    def to_dict(self) -> Dict[str, object]:
        return {
            "handle": self.handle,
            "count": self.count,
            "fetched_at": datetime.fromtimestamp(
                self.fetched_at, tz=timezone.utc
            ).isoformat(),
            "source": self.source,
            "is_mock": self.is_mock,
            "error": self.error,
            "from_cache": self.from_cache,
        }


@dataclass
class CacheEntry:
    stats: AccountStats
    expires_at: float


def _now() -> float:
    return time.time()


def _now_iso() -> str:
    return datetime.now(tz=timezone.utc).isoformat()


def _build_session() -> Session:
    session = requests.Session()
    retry = Retry(
        total=SCRAPER_RETRIES,
        backoff_factor=0.5,
        status_forcelist=(429, 500, 502, 503, 504),
        allowed_methods=("GET",),
        raise_on_status=False,
    )
    adapter = HTTPAdapter(max_retries=retry)
    session.mount("http://", adapter)
    session.mount("https://", adapter)
    session.headers.update(
        {
            "User-Agent": (
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36"
            ),
            "Accept": "text/html,application/json;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
        }
    )
    session.trust_env = True
    return session


def _parse_compact_number(text: str) -> Optional[int]:
    if not text:
        return None
    cleaned = text.replace("\u00a0", " ").strip()
    match = re.search(r"([0-9]+(?:[.,][0-9]+)?)\s*([KMB]?)", cleaned, re.IGNORECASE)
    if not match:
        digits = re.sub(r"[^0-9]", "", cleaned)
        if digits:
            return int(digits)
        return None
    number_token = match.group(1)
    suffix = match.group(2).upper()
    if "," in number_token and "." not in number_token:
        number_token = number_token.replace(",", ".")
    numeric = float(number_token.replace(",", ""))
    multiplier = 1
    if suffix == "K":
        multiplier = 1_000
    elif suffix == "M":
        multiplier = 1_000_000
    elif suffix == "B":
        multiplier = 1_000_000_000
    return int(round(numeric * multiplier))
def _extract_json_blob(html: str, regex: re.Pattern[str]) -> Optional[dict]:
    match = regex.search(html)
    if not match:
        return None
    blob = match.group(1)
    try:
        return json.loads(blob)
    except json.JSONDecodeError:
        return None


def _search_for_subscriber_count(node: object) -> Optional[int]:
    if node is None:
        return None
    if isinstance(node, dict):
        if "subscriberCountText" in node:
            value = node["subscriberCountText"]
            if isinstance(value, dict):
                if "simpleText" in value:
                    count = _parse_compact_number(value["simpleText"])
                    if count is not None:
                        return count
                runs = value.get("runs")
                if isinstance(runs, list):
                    joined = " ".join(
                        str(part.get("text", "")) for part in runs if isinstance(part, dict)
                    )
                    count = _parse_compact_number(joined)
                    if count is not None:
                        return count
            elif isinstance(value, str):
                count = _parse_compact_number(value)
                if count is not None:
                    return count
        if "subscriberCount" in node:
            count = _parse_compact_number(str(node["subscriberCount"]))
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
        count = _parse_compact_number(node)
        if count is not None:
            return count
    return None


class SocialPipeline:
    """Fetch and cache social follower counts across providers."""

    def __init__(self, data_dir: Path, logger: Optional[logging.Logger] = None):
        self.data_dir = data_dir
        self.logger = logger or logging.getLogger(__name__)
        self.session = _build_session()
        self.cache_ttl = max(DEFAULT_CACHE_SECONDS, 0)
        self.cache: Dict[Tuple[str, str], CacheEntry] = {}
        default_config = Path(__file__).resolve().parent / "social_handles.json"
        self.config_path = Path(
            os.environ.get("SOCIAL_CONFIG_FILE", str(default_config))
        )
        self._config_mtime: Optional[float] = None
        self._config: Dict[str, List[str]] = {}
        self._config_source: str = "empty"
        self._load_config()

    # ------------------------------------------------------------------
    # Configuration
    # ------------------------------------------------------------------
    def _load_config(self) -> None:
        env_config = os.environ.get("SOCIAL_OVERVIEW_HANDLES")
        loaded: Dict[str, List[str]] = {}
        source = "empty"
        if env_config:
            try:
                parsed = json.loads(env_config)
                if isinstance(parsed, dict):
                    loaded = self._normalize_config(parsed)
                    source = "env"
            except json.JSONDecodeError:
                self.logger.warning("Invalid SOCIAL_OVERVIEW_HANDLES JSON")
        elif self.config_path.exists():
            try:
                with self.config_path.open("r", encoding="utf-8") as handle:
                    parsed = json.load(handle)
                if isinstance(parsed, dict):
                    loaded = self._normalize_config(parsed)
                    source = "file"
            except (OSError, json.JSONDecodeError) as exc:
                self.logger.warning("Failed to load social config: %s", exc)
        self._config = loaded
        self._config_source = source
        if self.config_path.exists():
            try:
                self._config_mtime = self.config_path.stat().st_mtime
            except OSError:
                self._config_mtime = None

    def _normalize_config(self, parsed: dict) -> Dict[str, List[str]]:
        normalized: Dict[str, List[str]] = {}
        for platform, entries in parsed.items():
            if not isinstance(platform, str):
                continue
            platform_key = platform.lower()
            handles: List[str] = []
            if isinstance(entries, list):
                for entry in entries:
                    handle = None
                    if isinstance(entry, str):
                        handle = entry.strip()
                    elif isinstance(entry, dict):
                        for key in ("handle", "id", "username", "name"):
                            value = entry.get(key)
                            if isinstance(value, str) and value.strip():
                                handle = value.strip()
                                break
                    if handle:
                        if handle not in handles:
                            handles.append(handle)
            if handles:
                normalized[platform_key] = handles
        return normalized

    def _reload_config_if_needed(self) -> None:
        if not self.config_path.exists():
            return
        try:
            mtime = self.config_path.stat().st_mtime
        except OSError:
            return
        if self._config_mtime is None or mtime > self._config_mtime:
            self._load_config()

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------
    def get_overview(self) -> Dict[str, object]:
        self._reload_config_if_needed()
        platforms: Dict[str, object] = {}
        for platform, handles in self._config.items():
            if platform not in SUPPORTED_PLATFORMS:
                continue
            platforms[platform] = self._gather_platform(platform, handles)
        return {
            "platforms": platforms,
            "meta": {
                "generated_at": _now_iso(),
                "cache_ttl_seconds": self.cache_ttl,
            },
        }

    def get_config(self) -> Dict[str, object]:
        """Return the configured handles for each supported platform."""

        self._reload_config_if_needed()
        handles = {
            platform: list(platform_handles)
            for platform, platform_handles in self._config.items()
            if platform in SUPPORTED_PLATFORMS
        }
        return {
            "platforms": {
                platform: {"handles": list(values)}
                for platform, values in handles.items()
            },
            "handles": handles,
            "meta": {
                "generated_at": _now_iso(),
                "source": self._config_source,
            },
        }

    def get_platform_stats(self, platform: str, handles: Iterable[str]) -> Dict[str, object]:
        platform_key = platform.lower()
        if platform_key not in SUPPORTED_PLATFORMS:
            raise UnsupportedPlatformError(f"Unsupported platform: {platform}")
        normalized_handles = [
            handle.strip() for handle in handles if handle and handle.strip()
        ]
        if not normalized_handles:
            raise ValueError("At least one handle must be provided")
        return self._gather_platform(platform_key, normalized_handles)

    # ------------------------------------------------------------------
    # Aggregation helpers
    # ------------------------------------------------------------------
    def _gather_platform(self, platform: str, handles: List[str]) -> Dict[str, object]:
        per_account: List[Dict[str, object]] = []
        total_count = 0
        successful_accounts = 0
        requested: List[str] = []
        for handle in handles:
            requested.append(handle)
            stats = self._fetch_account(platform, handle)
            per_account.append(stats.to_dict())
            if isinstance(stats.count, int):
                successful_accounts += 1
                total_count += stats.count
        totals = {
            "count": total_count if successful_accounts else None,
            "accounts": successful_accounts,
            "requested": len(requested),
        }
        return {
            "platform": platform,
            "handles": requested,
            "per_account": per_account,
            "totals": totals,
            "generated_at": _now_iso(),
        }

    def _fetch_account(self, platform: str, handle: str) -> AccountStats:
        key = (platform, handle.lower())
        now = _now()
        if self.cache_ttl > 0:
            cached = self.cache.get(key)
            if cached and cached.expires_at > now:
                return replace(cached.stats, from_cache=True)
        stats = self._resolve_account(platform, handle)
        if self.cache_ttl > 0 and not stats.is_mock:
            self.cache[key] = CacheEntry(stats=stats, expires_at=now + self.cache_ttl)
        return stats

    def _resolve_account(self, platform: str, handle: str) -> AccountStats:
        if platform == "youtube":
            return self._resolve_youtube(handle)
        if platform == "instagram":
            return self._resolve_instagram(handle)
        if platform == "tiktok":
            return self._resolve_tiktok(handle)
        if platform == "facebook":
            return self._resolve_facebook(handle)
        raise UnsupportedPlatformError(f"Unsupported platform: {platform}")

    # ------------------------------------------------------------------
    # Platform orchestrators
    # ------------------------------------------------------------------
    def _resolve_youtube(self, handle: str) -> AccountStats:
        api_key = os.environ.get("SOCIAL_YOUTUBE_API_KEY")
        if api_key:
            api_result = self._fetch_youtube_api(handle, api_key)
            if api_result.count is not None:
                return api_result
        return self._fetch_youtube_scrape(handle)

    def _resolve_instagram(self, handle: str) -> AccountStats:
        access_token = os.environ.get("SOCIAL_INSTAGRAM_ACCESS_TOKEN")
        user_id = os.environ.get("SOCIAL_INSTAGRAM_USER_ID")
        if access_token and user_id:
            api_result = self._fetch_instagram_api(user_id, access_token, handle)
            if api_result.count is not None:
                return api_result
        return self._fetch_instagram_scrape(handle)

    def _resolve_tiktok(self, handle: str) -> AccountStats:
        return self._fetch_tiktok_scrape(handle)

    def _resolve_facebook(self, handle: str) -> AccountStats:
        access_token = os.environ.get("SOCIAL_FACEBOOK_ACCESS_TOKEN")
        page_id = os.environ.get("SOCIAL_FACEBOOK_PAGE_ID")
        if access_token and page_id and handle == page_id:
            api_result = self._fetch_facebook_api(page_id, access_token)
            if api_result.count is not None:
                return api_result
        return self._fetch_facebook_scrape(handle)

    # ------------------------------------------------------------------
    # HTTP helpers
    # ------------------------------------------------------------------
    def _request(
        self,
        url: str,
        platform: str,
        handle: str,
        attempt: str,
        headers: Optional[Dict[str, str]] = None,
    ) -> Optional[Response]:
        start = time.perf_counter()
        try:
            response = self.session.get(
                url, timeout=SCRAPER_TIMEOUT_SECONDS, headers=headers
            )
        except requests.RequestException as exc:
            elapsed = time.perf_counter() - start
            self.logger.info(
                "%s handle=%s attempt=%s url=%s error=%s elapsed=%.2fs",
                platform,
                handle,
                attempt,
                url,
                exc,
                elapsed,
            )
            return None
        elapsed = time.perf_counter() - start
        self.logger.info(
            "%s handle=%s attempt=%s url=%s status=%s elapsed=%.2fs",
            platform,
            handle,
            attempt,
            url,
            response.status_code,
            elapsed,
        )
        return response

    def _fetch_text(self, url: str, platform: str, handle: str) -> Optional[str]:
        proxy_url = f"{TEXT_PROXY_PREFIX}{url}"
        response = self._request(proxy_url, platform, handle, "text-proxy")
        if response and response.ok:
            return response.text
        return None
    # ------------------------------------------------------------------
    # YouTube
    # ------------------------------------------------------------------
    def _fetch_youtube_api(self, handle: str, api_key: str) -> AccountStats:
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
            response = self.session.get(
                url, params=params, timeout=SCRAPER_TIMEOUT_SECONDS
            )
            status = response.status_code
            self.logger.info(
                "youtube handle=%s attempt=api url=%s status=%s",
                handle,
                response.url,
                status,
            )
            if not response.ok:
                return AccountStats(
                    handle=handle,
                    count=None,
                    fetched_at=_now(),
                    source="api",
                    error=f"HTTP {status}",
                )
            payload = response.json()
        except (requests.RequestException, ValueError) as exc:
            elapsed = time.perf_counter() - start
            self.logger.info(
                "youtube handle=%s attempt=api error=%s elapsed=%.2fs",
                handle,
                exc,
                elapsed,
            )
            return AccountStats(
                handle=handle,
                count=None,
                fetched_at=_now(),
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
                self.logger.info(
                    "youtube handle=%s attempt=api parse=statistics count=%s elapsed=%.2fs",
                    handle,
                    numeric,
                    elapsed,
                )
                return AccountStats(
                    handle=handle,
                    count=numeric,
                    fetched_at=_now(),
                    source="api",
                )
        return AccountStats(
            handle=handle,
            count=None,
            fetched_at=_now(),
            source="api",
            error="Missing subscriber count",
        )

    def _youtube_candidate_urls(self, handle: str) -> List[str]:
        slug = handle.strip()
        urls: List[str] = []
        if slug.startswith("UC"):
            urls.append(
                f"https://www.youtube.com/channel/{slug}/about?hl=en&gl=US&persist_hl=1&persist_gl=1"
            )
            urls.append(
                f"https://www.youtube.com/channel/{slug}?hl=en&gl=US&persist_hl=1&persist_gl=1"
            )
        else:
            slug = slug.lstrip("@")
            urls.append(
                f"https://www.youtube.com/@{slug}/about?hl=en&gl=US&persist_hl=1&persist_gl=1"
            )
            urls.append(
                f"https://www.youtube.com/@{slug}?hl=en&gl=US&persist_hl=1&persist_gl=1"
            )
        return urls

    def _fetch_youtube_scrape(self, handle: str) -> AccountStats:
        last_error = ""
        for url in self._youtube_candidate_urls(handle):
            response = self._request(url, "youtube", handle, "direct")
            html = response.text if response and response.ok else ""
            parse = self._parse_youtube_html(html, handle, "direct", url)
            if parse is not None:
                return AccountStats(
                    handle=handle,
                    count=parse[0],
                    fetched_at=_now(),
                    source=f"scrape:{parse[1]}",
                )
            if response is None or not response.ok or not html:
                last_error = (
                    f"HTTP {response.status_code}" if response else "request error"
                )
            proxy_html = self._fetch_text(url, "youtube", handle)
            parse = self._parse_youtube_html(proxy_html or "", handle, "text-proxy", url)
            if parse is not None:
                return AccountStats(
                    handle=handle,
                    count=parse[0],
                    fetched_at=_now(),
                    source=f"scrape:{parse[1]}",
                )
            last_error = "No subscriber pattern found"
        return AccountStats(
            handle=handle,
            count=None,
            fetched_at=_now(),
            source="scrape",
            error=last_error or "No subscriber data",
        )

    def _parse_youtube_html(
        self, html: str, handle: str, attempt: str, url: str
    ) -> Optional[Tuple[int, str]]:
        if not html:
            self.logger.info(
                "youtube handle=%s attempt=%s url=%s parse=empty-html",
                handle,
                attempt,
                url,
            )
            return None
        data = _extract_json_blob(html, YT_INITIAL_DATA_RE)
        if data:
            count = _search_for_subscriber_count(data)
            if count is not None:
                self.logger.info(
                    "youtube handle=%s attempt=%s parse=ytInitialData count=%s",
                    handle,
                    attempt,
                    count,
                )
                self._log_youtube_secondary_counts(html, handle, attempt)
                return count, f"{attempt}:ytInitialData"
            self.logger.info(
                "youtube handle=%s attempt=%s parse=ytInitialData-miss",
                handle,
                attempt,
            )
        else:
            self.logger.info(
                "youtube handle=%s attempt=%s parse=ytInitialData-missing",
                handle,
                attempt,
            )
        player_data = _extract_json_blob(html, YT_INITIAL_PLAYER_RE)
        if player_data:
            count = _search_for_subscriber_count(player_data)
            if count is not None:
                self.logger.info(
                    "youtube handle=%s attempt=%s parse=ytInitialPlayerResponse count=%s",
                    handle,
                    attempt,
                    count,
                )
                self._log_youtube_secondary_counts(html, handle, attempt)
                return count, f"{attempt}:ytInitialPlayerResponse"
            self.logger.info(
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
                self.logger.info(
                    "youtube handle=%s attempt=%s parse=ytcfg count=%s",
                    handle,
                    attempt,
                    count,
                )
                self._log_youtube_secondary_counts(html, handle, attempt)
                return count, f"{attempt}:ytcfg"
        if not found_cfg:
            self.logger.info(
                "youtube handle=%s attempt=%s parse=ytcfg-missing",
                handle,
                attempt,
            )
        match = YT_SUBSCRIBERS_RE.search(html)
        if match:
            count = _parse_compact_number(" ".join(match.groups()))
            if count is not None:
                self.logger.info(
                    "youtube handle=%s attempt=%s parse=regex-subscribers count=%s",
                    handle,
                    attempt,
                    count,
                )
                self._log_youtube_secondary_counts(html, handle, attempt)
                return count, f"{attempt}:regex"
        else:
            self.logger.info(
                "youtube handle=%s attempt=%s parse=regex-subscribers-miss",
                handle,
                attempt,
            )
        self._log_youtube_secondary_counts(html, handle, attempt)
        return None

    def _log_youtube_secondary_counts(
        self, html: str, handle: str, attempt: str
    ) -> None:
        videos_match = YT_VIDEOS_RE.search(html)
        if videos_match:
            videos = _parse_compact_number(" ".join(videos_match.groups()))
            if videos is not None:
                self.logger.info(
                    "youtube handle=%s attempt=%s parse=regex-videos count=%s",
                    handle,
                    attempt,
                    videos,
                )
        views_match = YT_VIEWS_RE.search(html)
        if views_match:
            views = _parse_compact_number(" ".join(views_match.groups()))
            if views is not None:
                self.logger.info(
                    "youtube handle=%s attempt=%s parse=regex-views count=%s",
                    handle,
                    attempt,
                    views,
                )

    # ------------------------------------------------------------------
    # Instagram
    # ------------------------------------------------------------------
    def _fetch_instagram_api(
        self, user_id: str, access_token: str, handle: str
    ) -> AccountStats:
        url = f"https://graph.facebook.com/v17.0/{user_id}"
        params = {"fields": "followers_count", "access_token": access_token}
        try:
            response = self.session.get(
                url, params=params, timeout=SCRAPER_TIMEOUT_SECONDS
            )
            status = response.status_code
            self.logger.info(
                "instagram handle=%s attempt=api url=%s status=%s",
                handle,
                response.url,
                status,
            )
            if not response.ok:
                return AccountStats(
                    handle=handle,
                    count=None,
                    fetched_at=_now(),
                    source="api",
                    error=f"HTTP {status}",
                )
            payload = response.json()
        except (requests.RequestException, ValueError) as exc:
            self.logger.info("instagram handle=%s attempt=api error=%s", handle, exc)
            return AccountStats(
                handle=handle,
                count=None,
                fetched_at=_now(),
                source="api",
                error=str(exc),
            )
        count = payload.get("followers_count")
        if isinstance(count, int):
            self.logger.info(
                "instagram handle=%s attempt=api parse=followers_count count=%s",
                handle,
                count,
            )
            return AccountStats(
                handle=handle,
                count=count,
                fetched_at=_now(),
                source="api",
            )
        return AccountStats(
            handle=handle,
            count=None,
            fetched_at=_now(),
            source="api",
            error="Missing followers_count",
        )

    def _fetch_instagram_scrape(self, handle: str) -> AccountStats:
        slug = handle.lstrip("@")
        attempts = [
            (
                "json",
                f"https://www.instagram.com/api/v1/users/web_profile_info/?username={slug}",
            ),
            (
                "json",
                f"https://i.instagram.com/api/v1/users/web_profile_info/?username={slug}",
            ),
            ("direct", f"https://www.instagram.com/{slug}/?__a=1&__d=1"),
            ("direct", f"https://www.instagram.com/{slug}/"),
        ]
        for attempt, url in attempts:
            headers = None
            if attempt == "json":
                headers = {
                    "Accept": "application/json",
                    "X-IG-App-ID": INSTAGRAM_WEB_APP_ID,
                    "Referer": "https://www.instagram.com/",
                }
            response = self._request(url, "instagram", handle, attempt, headers=headers)
            body = response.text if response and response.ok else ""
            count, source = self._parse_instagram_payload(body, handle, attempt, url)
            if count is not None:
                return AccountStats(
                    handle=handle,
                    count=count,
                    fetched_at=_now(),
                    source=f"scrape:{source}",
                )
            if attempt == "direct":
                proxy_body = self._fetch_text(url, "instagram", handle)
                count, source = self._parse_instagram_payload(
                    proxy_body or "", handle, "text-proxy", url
                )
                if count is not None:
                    return AccountStats(
                        handle=handle,
                        count=count,
                        fetched_at=_now(),
                        source=f"scrape:{source}",
                    )
        return AccountStats(
            handle=handle,
            count=None,
            fetched_at=_now(),
            source="scrape",
            error="Missing followers",
        )

    def _parse_instagram_payload(
        self, payload: str, handle: str, attempt: str, url: str
    ) -> Tuple[Optional[int], str]:
        if not payload:
            self.logger.info(
                "instagram handle=%s attempt=%s url=%s parse=empty",
                handle,
                attempt,
                url,
            )
            return None, attempt
        try:
            data = json.loads(payload)
        except json.JSONDecodeError:
            data = None
        if isinstance(data, dict):
            containers = [
                ("data", data.get("data")),
                ("graphql", data.get("graphql")),
            ]
            for label, container in containers:
                if not isinstance(container, dict):
                    continue
                user = container.get("user")
                if not isinstance(user, dict):
                    continue
                edge_followed_by = user.get("edge_followed_by", {})
                if isinstance(edge_followed_by, dict):
                    count = edge_followed_by.get("count")
                elif isinstance(edge_followed_by, int):
                    count = edge_followed_by
                else:
                    count = None
                if isinstance(count, int):
                    parse_label = (
                        "graphql" if label == "graphql" else f"{label}_edge_followed_by"
                    )
                    self.logger.info(
                        "instagram handle=%s attempt=%s parse=%s count=%s",
                        handle,
                        attempt,
                        parse_label,
                        count,
                    )
                    return count, f"{attempt}:{parse_label}"
                follower_count = user.get("follower_count")
                if isinstance(follower_count, int):
                    parse_label = (
                        "graphql_follower_count"
                        if label == "graphql"
                        else f"{label}_follower_count"
                    )
                    self.logger.info(
                        "instagram handle=%s attempt=%s parse=%s count=%s",
                        handle,
                        attempt,
                        parse_label,
                        follower_count,
                    )
                    return follower_count, f"{attempt}:{parse_label}"
        ld_match = INSTAGRAM_LD_JSON_RE.search(payload)
        if ld_match:
            try:
                ld_data = json.loads(ld_match.group(1))
            except json.JSONDecodeError:
                ld_data = None
            if isinstance(ld_data, dict):
                stats = ld_data.get("interactionStatistic")
                if isinstance(stats, list):
                    for entry in stats:
                        if not isinstance(entry, dict):
                            continue
                        if entry.get("name") == "Followers":
                            count = entry.get("userInteractionCount")
                            if isinstance(count, int):
                                self.logger.info(
                                    "instagram handle=%s attempt=%s parse=ldjson count=%s",
                                    handle,
                                    attempt,
                                    count,
                                )
                                return count, f"{attempt}:ldjson"
        regex_match = re.search(
            r'"edge_followed_by"\s*:\s*\{\"count\":\s*([0-9]+)', payload
        )
        if regex_match:
            count = int(regex_match.group(1))
            self.logger.info(
                "instagram handle=%s attempt=%s parse=regex count=%s",
                handle,
                attempt,
                count,
            )
            return count, f"{attempt}:regex"
        self.logger.info(
            "instagram handle=%s attempt=%s url=%s parse=miss",
            handle,
            attempt,
            url,
        )
        return None, attempt

    # ------------------------------------------------------------------
    # TikTok
    # ------------------------------------------------------------------
    def _fetch_tiktok_scrape(self, handle: str) -> AccountStats:
        slug = handle.lstrip("@")
        url = f"https://www.tiktok.com/@{slug}"
        response = self._request(url, "tiktok", handle, "direct")
        html = response.text if response and response.ok else ""
        count, source = self._parse_tiktok_html(html, handle, "direct", url)
        if count is not None:
            return AccountStats(
                handle=handle,
                count=count,
                fetched_at=_now(),
                source=f"scrape:{source}",
            )
        proxy_html = self._fetch_text(url, "tiktok", handle)
        count, source = self._parse_tiktok_html(proxy_html or "", handle, "text-proxy", url)
        if count is not None:
            return AccountStats(
                handle=handle,
                count=count,
                fetched_at=_now(),
                source=f"scrape:{source}",
            )
        return AccountStats(
            handle=handle,
            count=None,
            fetched_at=_now(),
            source="scrape",
            error="Missing follower count",
        )

    def _parse_tiktok_html(
        self, html: str, handle: str, attempt: str, url: str
    ) -> Tuple[Optional[int], str]:
        if not html:
            self.logger.info(
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
                                self.logger.info(
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
                            self.logger.info(
                                "tiktok handle=%s attempt=%s parse=SIGI_STATE-stats count=%s",
                                handle,
                                attempt,
                                count,
                            )
                            return count, f"{attempt}:sigi-stats"
        regex_match = re.search(r'"followerCount"\s*:\s*([0-9]+)', html)
        if regex_match:
            count = int(regex_match.group(1))
            self.logger.info(
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
            count = _parse_compact_number(fallback_match.group(1))
            if count is not None:
                self.logger.info(
                    "tiktok handle=%s attempt=%s parse=regex-text count=%s",
                    handle,
                    attempt,
                    count,
                )
                return count, f"{attempt}:regex-text"
        self.logger.info(
            "tiktok handle=%s attempt=%s url=%s parse=miss",
            handle,
            attempt,
            url,
        )
        return None, attempt

    # ------------------------------------------------------------------
    # Facebook
    # ------------------------------------------------------------------
    def _fetch_facebook_api(self, page_id: str, access_token: str) -> AccountStats:
        url = f"https://graph.facebook.com/v17.0/{page_id}"
        params = {"fields": "fan_count", "access_token": access_token}
        try:
            response = self.session.get(
                url, params=params, timeout=SCRAPER_TIMEOUT_SECONDS
            )
            status = response.status_code
            self.logger.info(
                "facebook handle=%s attempt=api url=%s status=%s",
                page_id,
                response.url,
                status,
            )
            if not response.ok:
                return AccountStats(
                    handle=page_id,
                    count=None,
                    fetched_at=_now(),
                    source="api",
                    error=f"HTTP {status}",
                )
            payload = response.json()
        except (requests.RequestException, ValueError) as exc:
            self.logger.info("facebook handle=%s attempt=api error=%s", page_id, exc)
            return AccountStats(
                handle=page_id,
                count=None,
                fetched_at=_now(),
                source="api",
                error=str(exc),
            )
        count = payload.get("fan_count")
        if isinstance(count, int):
            self.logger.info(
                "facebook handle=%s attempt=api parse=fan_count count=%s",
                page_id,
                count,
            )
            return AccountStats(
                handle=page_id,
                count=count,
                fetched_at=_now(),
                source="api",
            )
        return AccountStats(
            handle=page_id,
            count=None,
            fetched_at=_now(),
            source="api",
            error="Missing fan_count",
        )

    def _fetch_facebook_scrape(self, handle: str) -> AccountStats:
        slug = handle.lstrip("@")
        urls = [
            f"https://mbasic.facebook.com/{slug}",
            f"https://mbasic.facebook.com/{slug}?v=info",
            f"https://www.facebook.com/{slug}",
        ]
        for url in urls:
            response = self._request(url, "facebook", handle, "direct")
            html = response.text if response and response.ok else ""
            count, source = self._parse_facebook_html(html, handle, "direct", url)
            if count is not None:
                return AccountStats(
                    handle=handle,
                    count=count,
                    fetched_at=_now(),
                    source=f"scrape:{source}",
                )
            proxy_html = self._fetch_text(url, "facebook", handle)
            count, source = self._parse_facebook_html(
                proxy_html or "", handle, "text-proxy", url
            )
            if count is not None:
                return AccountStats(
                    handle=handle,
                    count=count,
                    fetched_at=_now(),
                    source=f"scrape:{source}",
                )
        return AccountStats(
            handle=handle,
            count=None,
            fetched_at=_now(),
            source="scrape",
            error="Missing followers",
        )

    def _parse_facebook_html(
        self, html: str, handle: str, attempt: str, url: str
    ) -> Tuple[Optional[int], str]:
        if not html:
            self.logger.info(
                "facebook handle=%s attempt=%s url=%s parse=empty",
                handle,
                attempt,
                url,
            )
            return None, attempt
        aria_match = FACEBOOK_ARIA_LABEL_RE.search(html)
        if aria_match:
            count = _parse_compact_number(aria_match.group(1))
            if count is not None:
                self.logger.info(
                    "facebook handle=%s attempt=%s parse=aria-label count=%s",
                    handle,
                    attempt,
                    count,
                )
                return count, f"{attempt}:aria-label"

        text_variants: List[Tuple[str, str]] = [(html, attempt)]
        if "<" in html:
            stripped = re.sub(r"<[^>]+>", " ", html)
            normalized = re.sub(r"\s+", " ", unescape(stripped)).strip()
            if normalized:
                text_variants.append((normalized, f"{attempt}-text"))

        markdown = re.sub(r"\[(.*?)\]\((.*?)\)", r"\1", html)
        markdown = re.sub(r"[\[\]*_`]", "", markdown)
        markdown = markdown.replace("•", " ")
        markdown = re.sub(r"\s+", " ", unescape(markdown)).strip()
        if markdown and markdown != html:
            text_variants.append((markdown, f"{attempt}-markdown"))

        for candidate, label in text_variants:
            match = FACEBOOK_FOLLOW_RE.search(candidate)
            if match:
                count = _parse_compact_number(match.group(1))
                if count is not None:
                    self.logger.info(
                        "facebook handle=%s attempt=%s parse=follow-this count=%s",
                        handle,
                        label,
                        count,
                    )
                    return count, f"{label}:follow-this"
            match = FACEBOOK_FOLLOWERS_RE.search(candidate)
            if match:
                count = _parse_compact_number(match.group(1))
                if count is not None:
                    self.logger.info(
                        "facebook handle=%s attempt=%s parse=followers count=%s",
                        handle,
                        label,
                        count,
                    )
                    return count, f"{label}:followers"

        match = FACEBOOK_JSON_RE.search(html)
        if match:
            count = int(match.group(1))
            self.logger.info(
                "facebook handle=%s attempt=%s parse=fan_count-json count=%s",
                handle,
                attempt,
                count,
            )
            return count, f"{attempt}:fan_count"
        self.logger.info(
            "facebook handle=%s attempt=%s url=%s parse=miss",
            handle,
            attempt,
            url,
        )
        return None, attempt
