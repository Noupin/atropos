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

from .context import PlatformContext, RequestOutcome
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
        global_views = 0
        global_views_accounts = 0
        for platform, handles in self._config.items():
            if platform not in SUPPORTED_PLATFORMS:
                continue
            platform_payload = self._gather_platform(platform, handles)
            platforms[platform] = platform_payload
            totals = platform_payload.get("totals", {})
            if isinstance(totals, dict):
                views_value = totals.get("views")
                views_accounts = totals.get("views_accounts")
                if isinstance(views_value, int) and views_value >= 0:
                    global_views += views_value
                if isinstance(views_accounts, int) and views_accounts > 0:
                    global_views_accounts += views_accounts
        totals_payload = {
            "views": global_views if global_views_accounts else None,
            "views_accounts": global_views_accounts,
        }
        return {
            "platforms": platforms,
            "totals": totals_payload,
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
        requested: List[str] = []
        views_total = 0
        views_accounts = 0
        for handle in handles:
            requested.append(handle)
            stats = self._fetch_account(platform, handle)
            per_account.append(stats.to_dict())
            if isinstance(stats.count, int):
                successful_accounts += 1
                total_count += stats.count
            extra = stats.extra or {}
            views_value = extra.get("views") if isinstance(extra, dict) else None
            if isinstance(views_value, int) and views_value >= 0:
                views_total += views_value
                views_accounts += 1
        totals = {
            "count": total_count if successful_accounts else None,
            "accounts": successful_accounts,
            "requested": len(requested),
            "views": views_total if views_accounts else None,
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
    ) -> RequestOutcome:
        request_url = url
        if attempt == "text-proxy":
            request_url = f"{TEXT_PROXY_PREFIX}{url}"
        start = time.perf_counter()
        try:
            response = self.session.get(
                request_url, timeout=SCRAPER_TIMEOUT_SECONDS, headers=headers
            )
        except requests.RequestException as exc:
            elapsed = time.perf_counter() - start
            return RequestOutcome(
                url=request_url,
                attempt=attempt,
                elapsed=elapsed,
                response=None,
                status=None,
                error=str(exc),
            )
        elapsed = time.perf_counter() - start
        return RequestOutcome(
            url=request_url,
            attempt=attempt,
            elapsed=elapsed,
            response=response,
            status=response.status_code,
        )

    def _log_attempt(
        self,
        platform: str,
        handle: str,
        outcome: RequestOutcome,
        parse: str,
        followers: Optional[int],
        views: Optional[int],
        detail: Optional[str],
    ) -> None:
        status: Optional[str]
        if outcome.status is not None:
            status = str(outcome.status)
        elif outcome.error:
            status = "error"
        else:
            status = "unknown"
        message = (
            "platform=%s handle=%s attempt=%s url=%s status=%s parse=%s "
            "followers=%s views=%s elapsed=%.2fs"
        ) % (
            platform,
            handle,
            outcome.attempt,
            outcome.url,
            status,
            parse,
            followers if followers is not None else "null",
            views if views is not None else "null",
            outcome.elapsed,
        )
        extras: List[str] = []
        if detail:
            extras.append(f"detail={detail}")
        if outcome.error:
            extras.append(f"error={outcome.error}")
        if extras:
            message = f"{message} {' '.join(extras)}"
        self.logger.info(message)

    def _build_context(self) -> PlatformContext:
        return PlatformContext(
            session=self.session,
            logger=self.logger,
            request=self._request,
            log_attempt=self._log_attempt,
            now=_now,
            instagram_web_app_id=INSTAGRAM_WEB_APP_ID,
        )
