from __future__ import annotations

import json
import logging
import math
import os
import time
from dataclasses import replace
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Iterable, List, Mapping, Optional, Sequence, Tuple

import requests
from requests import Response, Session
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

from .context import PlatformContext
from .exceptions import UnsupportedPlatformError
from .models import AccountStats
from .platforms import get_resolver, supported_platforms
from .settings import (
    DEFAULT_CACHE_SECONDS,
    INSTAGRAM_WEB_APP_ID,
    SCRAPER_RETRIES,
    SCRAPER_TIMEOUT_SECONDS,
    TEXT_PROXY_PREFIX,
)
from .utils import parse_compact_number

SUPPORTED_PLATFORMS = supported_platforms()


class CacheEntry:
    def __init__(self, stats: AccountStats, expires_at: float):
        self.stats = stats
        self.expires_at = expires_at


def _now() -> float:
    return time.time()


def _now_iso() -> str:
    return datetime.now(tz=timezone.utc).isoformat()


VIEW_KEYS: Sequence[str] = (
    "views",
    "view_count",
    "viewCount",
    "total_views",
    "totalViews",
    "plays",
    "play_count",
    "playCount",
)


def _coerce_positive_int(value: object) -> Optional[int]:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value if value >= 0 else None
    if isinstance(value, float):
        if math.isfinite(value) and value >= 0:
            return int(round(value))
        return None
    if isinstance(value, str):
        numeric = parse_compact_number(value)
        if numeric is not None and numeric >= 0:
            return numeric
        return None
    return None


def _extract_view_total(
    extra: Mapping[str, object] | None, depth: int = 0
) -> Optional[int]:
    if extra is None or not isinstance(extra, Mapping):
        return None
    if depth > 4:
        return None
    for key in VIEW_KEYS:
        if key in extra:
            numeric = _coerce_positive_int(extra[key])
            if numeric is not None:
                return numeric
    for value in extra.values():
        if isinstance(value, Mapping):
            nested = _extract_view_total(value, depth + 1)
            if nested is not None:
                return nested
        elif isinstance(value, list):
            for item in value:
                if isinstance(item, Mapping):
                    nested = _extract_view_total(item, depth + 1)
                    if nested is not None:
                        return nested
    return None


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


class SocialPipeline:
    """Fetch and cache social follower counts across providers."""

    def __init__(self, data_dir: Path, logger: Optional[logging.Logger] = None):
        self.data_dir = data_dir
        self.logger = logger or logging.getLogger(__name__)
        self.session = _build_session()
        self.cache_ttl = max(DEFAULT_CACHE_SECONDS, 0)
        self.cache: Dict[Tuple[str, str], CacheEntry] = {}
        default_config = Path(__file__).resolve().parent / ".." / "social_handles.json"
        default_config = default_config.resolve()
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
        aggregate_totals = {
            "accounts": 0,
            "count": 0,
            "views": 0,
            "views_accounts": 0,
        }
        has_count_total = False
        has_view_total = False
        for platform, handles in self._config.items():
            if platform not in SUPPORTED_PLATFORMS:
                continue
            platform_stats = self._gather_platform(platform, handles)
            platforms[platform] = platform_stats
            totals = platform_stats.get("totals")
            if isinstance(totals, dict):
                accounts_value = totals.get("accounts")
                if isinstance(accounts_value, int) and accounts_value >= 0:
                    aggregate_totals["accounts"] += accounts_value
                count_value = totals.get("count")
                if isinstance(count_value, int) and count_value >= 0:
                    aggregate_totals["count"] += count_value
                    has_count_total = True
                views_value = totals.get("views")
                if isinstance(views_value, int) and views_value >= 0:
                    aggregate_totals["views"] += views_value
                    has_view_total = True
                views_accounts_value = totals.get("views_accounts")
                if (
                    isinstance(views_accounts_value, int)
                    and views_accounts_value >= 0
                ):
                    aggregate_totals["views_accounts"] += views_accounts_value
        totals_payload: Dict[str, int] = {}
        if aggregate_totals["accounts"]:
            totals_payload["accounts"] = aggregate_totals["accounts"]
        if has_count_total:
            totals_payload["count"] = aggregate_totals["count"]
        if has_view_total:
            totals_payload["views"] = aggregate_totals["views"]
            totals_payload["views_accounts"] = aggregate_totals["views_accounts"]
        return {
            "platforms": platforms,
            "meta": {
                "generated_at": _now_iso(),
                "cache_ttl_seconds": self.cache_ttl,
            },
            "totals": totals_payload,
        }

    def get_config(self) -> Dict[str, object]:
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
        total_views = 0
        successful_accounts = 0
        view_accounts = 0
        requested: List[str] = []
        for handle in handles:
            requested.append(handle)
            stats = self._fetch_account(platform, handle)
            per_account.append(stats.to_dict())
            if isinstance(stats.count, int):
                successful_accounts += 1
                total_count += stats.count
            if isinstance(stats.extra, dict):
                views = _extract_view_total(stats.extra)
                if isinstance(views, int) and views >= 0:
                    view_accounts += 1
                    total_views += views
        totals = {
            "count": total_count if successful_accounts else None,
            "accounts": successful_accounts,
            "requested": len(requested),
        }
        if view_accounts:
            totals["views"] = total_views
            totals["views_accounts"] = view_accounts
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
        resolver = get_resolver(platform)
        context = self._build_context()
        return resolver(handle, context)

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

    def _build_context(self) -> PlatformContext:
        return PlatformContext(
            session=self.session,
            logger=self.logger,
            request=self._request,
            fetch_text=self._fetch_text,
            now=_now,
            instagram_web_app_id=INSTAGRAM_WEB_APP_ID,
        )
