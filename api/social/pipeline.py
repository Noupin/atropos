from __future__ import annotations

import json
import logging
import os
import time
from dataclasses import replace
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Tuple

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

SUPPORTED_PLATFORMS = supported_platforms()


class CacheEntry:
    def __init__(self, stats: AccountStats, expires_at: float):
        self.stats = stats
        self.expires_at = expires_at


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
        total_views = 0
        views_accounts = 0
        requested: List[str] = []
        for handle in handles:
            requested.append(handle)
            stats = self._fetch_account(platform, handle)
            per_account.append(stats.to_dict())
            if isinstance(stats.count, int):
                successful_accounts += 1
                total_count += stats.count
            if isinstance(stats.extra, dict):
                views_value = stats.extra.get("views")
                if isinstance(views_value, int):
                    total_views += views_value
                    views_accounts += 1
        totals = {
            "count": total_count if successful_accounts else None,
            "accounts": successful_accounts,
            "requested": len(requested),
            "views": total_views if views_accounts else None,
            "views_accounts": views_accounts,
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
