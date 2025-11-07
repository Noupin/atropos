from __future__ import annotations

"""Social follower/subscriber aggregation pipeline."""

import json
import logging
import os
import re
import threading
import time
from dataclasses import dataclass
from typing import Dict, Iterable, List, Optional, Tuple

import requests

try:  # pragma: no cover - allow use without package installation
    from .social_config import get_platform_flags, get_social_handles
except ImportError:  # pragma: no cover - fallback for script execution
    from social_config import get_platform_flags, get_social_handles


logger = logging.getLogger(__name__)


def _env_flag(name: str, default: bool = False) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    lowered = raw.strip().lower()
    if lowered in {"1", "true", "yes", "on"}:
        return True
    if lowered in {"0", "false", "no", "off"}:
        return False
    return default


ENABLE_SOCIAL_APIS = _env_flag("ENABLE_SOCIAL_APIS", False)
ENABLE_SOCIAL_SCRAPER = _env_flag("ENABLE_SOCIAL_SCRAPER", True)

ENABLE_YT_API = _env_flag("ENABLE_YT_API", True)
ENABLE_IG_API = _env_flag("ENABLE_IG_API", True)
ENABLE_TT_API = _env_flag("ENABLE_TT_API", False)
ENABLE_FB_API = _env_flag("ENABLE_FB_API", True)

YOUTUBE_API_KEY = os.environ.get("YOUTUBE_API_KEY", "").strip()
INSTAGRAM_ACCESS_TOKEN = os.environ.get("INSTAGRAM_ACCESS_TOKEN", "").strip()
FACEBOOK_ACCESS_TOKEN = os.environ.get("FACEBOOK_ACCESS_TOKEN", "").strip()

INSTAGRAM_ID_MAP: Dict[str, str] = {}
FACEBOOK_ID_MAP: Dict[str, str] = {}

try:
    raw_instagram_ids = os.environ.get("INSTAGRAM_ID_MAP")
    if raw_instagram_ids:
        parsed = json.loads(raw_instagram_ids)
        if isinstance(parsed, dict):
            INSTAGRAM_ID_MAP = {
                str(k): str(v)
                for k, v in parsed.items()
                if str(v).strip()
            }
except Exception:  # pragma: no cover - fail soft
    INSTAGRAM_ID_MAP = {}

try:
    raw_facebook_ids = os.environ.get("FACEBOOK_ID_MAP")
    if raw_facebook_ids:
        parsed = json.loads(raw_facebook_ids)
        if isinstance(parsed, dict):
            FACEBOOK_ID_MAP = {
                str(k): str(v)
                for k, v in parsed.items()
                if str(v).strip()
            }
except Exception:  # pragma: no cover - fail soft
    FACEBOOK_ID_MAP = {}

CACHE_TTL_SECONDS = int(os.environ.get("CACHE_TTL_SECONDS", "300") or "300")
SCRAPER_TIMEOUT_SECONDS = float(os.environ.get("SCRAPER_TIMEOUT_SECONDS", "6") or "6")
SCRAPER_RETRIES = int(os.environ.get("SCRAPER_RETRIES", "2") or "2")

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)


_CACHE: Dict[str, Tuple[float, "SocialStatsResponse"]] = {}
_CACHE_LOCK = threading.Lock()


@dataclass
class AccountStat:
    handle: str
    count: Optional[int]
    source: str
    error: Optional[str] = None
    approximate: bool = False


@dataclass
class SocialStatsResponse:
    platform: str
    per_account: List[AccountStat]
    totals: Dict[str, Optional[int]]
    source: str
    handles: List[str]


PLATFORM_CODES = {
    "yt": "youtube",
    "youtube": "youtube",
    "ig": "instagram",
    "instagram": "instagram",
    "tt": "tiktok",
    "tiktok": "tiktok",
    "fb": "facebook",
    "facebook": "facebook",
}
def _normalise_handles(handles: Iterable[str]) -> List[str]:
    seen = set()
    ordered: List[str] = []
    for handle in handles:
        if not handle:
            continue
        trimmed = handle.strip()
        if not trimmed:
            continue
        lowered = trimmed.lower()
        if lowered in seen:
            continue
        seen.add(lowered)
        ordered.append(trimmed)
    return ordered


def _format_cache_key(platform: str, handles: Iterable[str]) -> str:
    return f"{platform}:{','.join(sorted(h.lower() for h in handles))}"


def resolve_platform(alias: str) -> Optional[str]:
    return PLATFORM_CODES.get(alias.lower()) if alias else None


def _store_cache(key: str, payload: SocialStatsResponse) -> None:
    with _CACHE_LOCK:
        _CACHE[key] = (time.time(), payload)


def _get_cache(key: str) -> Optional[SocialStatsResponse]:
    with _CACHE_LOCK:
        entry = _CACHE.get(key)
        if not entry:
            return None
        ts, payload = entry
        if time.time() - ts > CACHE_TTL_SECONDS:
            _CACHE.pop(key, None)
            return None
        return payload


def _format_number_from_text(value: str) -> Optional[int]:
    if not value:
        return None
    text = value.strip().replace(",", "")
    match = re.match(r"^(~)?([0-9]+(?:\.[0-9]+)?)([KMB]?)", text, re.IGNORECASE)
    if not match:
        digits = re.findall(r"[0-9]+", text)
        if not digits:
            return None
        return int(digits[0])
    number = float(match.group(2))
    suffix = match.group(3).upper()
    multiplier = {
        "": 1,
        "K": 1_000,
        "M": 1_000_000,
        "B": 1_000_000_000,
    }.get(suffix, 1)
    return int(number * multiplier)


def _http_get(url: str, params: Optional[Dict[str, str]] = None) -> requests.Response:
    session = requests.Session()
    session.headers.update({
        "User-Agent": USER_AGENT,
        "Accept": "text/html,application/json;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.8",
    })
    last_exc: Optional[Exception] = None
    for attempt in range(1, SCRAPER_RETRIES + 2):
        try:
            response = session.get(
                url,
                params=params,
                timeout=SCRAPER_TIMEOUT_SECONDS,
            )
            response.raise_for_status()
            return response
        except Exception as exc:  # pragma: no cover - network variability
            last_exc = exc
            logger.warning("Request attempt %s failed for %s: %s", attempt, url, exc)
            time.sleep(0.3 * attempt)
    if last_exc:
        raise last_exc
    raise RuntimeError(f"Failed to fetch {url}")


def _fetch_youtube_api(handle: str) -> Optional[int]:
    if not (ENABLE_SOCIAL_APIS and ENABLE_YT_API and YOUTUBE_API_KEY):
        return None
    channel_id_param = None
    params = {
        "part": "statistics",
        "key": YOUTUBE_API_KEY,
    }
    cleaned = handle.strip()
    if cleaned.startswith("UC"):
        params["id"] = cleaned
        channel_id_param = "id"
    else:
        normalized = cleaned.lstrip("@")
        params["forHandle"] = normalized
        channel_id_param = "forHandle"
    try:
        response = _http_get(
            "https://www.googleapis.com/youtube/v3/channels",
            params=params,
        )
    except Exception as exc:
        logger.warning(
            "YouTube API error for %s (%s=%s): %s",
            handle,
            channel_id_param,
            params.get(channel_id_param, ""),
            exc,
        )
        return None
    data = response.json()
    try:
        items = data.get("items") or []
        stats = items[0]["statistics"]
        count = int(stats.get("subscriberCount"))
        return max(count, 0)
    except Exception:
        return None


def _fetch_youtube_scrape(handle: str) -> Optional[int]:
    cleaned = handle.strip()
    if cleaned.startswith("UC"):
        url = f"https://www.youtube.com/channel/{cleaned}/about"
    else:
        url = f"https://www.youtube.com/@{cleaned.lstrip('@')}/about"
    try:
        html = _http_get(url).text
    except Exception as exc:  # pragma: no cover - network variability
        logger.warning("YouTube scrape failed for %s: %s", handle, exc)
        return None
    patterns = [
        (
            r"\"subscriberCountText\"\s*:\s*{[^}]*\"simpleText\""
            r"\s*:\s*\"([^\"]+)\""
        ),
        (
            r"\"subscriberCountText\"\s*:\s*{[^}]*\"runs\"\s*:\s*\["
            r"\s*{[^}]*\"text\"\s*:\s*\"([^\"]+)\""
        ),
    ]
    for pattern in patterns:
        match = re.search(pattern, html)
        if match:
            parsed = _format_number_from_text(match.group(1))
            if parsed:
                return parsed
    return None


def _fetch_instagram_api(handle: str) -> Optional[int]:
    if not (ENABLE_SOCIAL_APIS and ENABLE_IG_API and INSTAGRAM_ACCESS_TOKEN):
        return None
    user_id = INSTAGRAM_ID_MAP.get(handle) or (handle if handle.isdigit() else None)
    if not user_id:
        return None
    params = {
        "fields": "followers_count",
        "access_token": INSTAGRAM_ACCESS_TOKEN,
    }
    url = f"https://graph.facebook.com/v21.0/{user_id}"
    try:
        data = _http_get(url, params=params).json()
    except Exception as exc:
        logger.warning("Instagram API error for %s: %s", handle, exc)
        return None
    count = data.get("followers_count")
    if isinstance(count, int):
        return max(count, 0)
    try:
        return max(int(count), 0)
    except Exception:
        return None


def _fetch_instagram_scrape(handle: str) -> Optional[int]:
    url = f"https://www.instagram.com/{handle.strip('@')}/"
    try:
        html = _http_get(url).text
    except Exception as exc:  # pragma: no cover - network variability
        logger.warning("Instagram scrape failed for %s: %s", handle, exc)
        return None
    match = re.search(r"\"edge_followed_by\"\s*:\s*{\s*\"count\"\s*:\s*([0-9]+)\s*}", html)
    if match:
        return int(match.group(1))
    meta_match = re.search(r"content=\"([0-9.,]+) followers", html)
    if meta_match:
        parsed = _format_number_from_text(meta_match.group(1))
        if parsed:
            return parsed
    return None


def _fetch_tiktok_api(handle: str) -> Optional[int]:
    if not (ENABLE_SOCIAL_APIS and ENABLE_TT_API):
        return None
    return None


def _fetch_tiktok_scrape(handle: str) -> Optional[int]:
    url = f"https://www.tiktok.com/@{handle.strip('@')}"
    try:
        html = _http_get(url).text
    except Exception as exc:  # pragma: no cover
        logger.warning("TikTok scrape failed for %s: %s", handle, exc)
        return None
    patterns = [
        r"\"followerCount\"\s*:\s*([0-9]+)",
        r"\"fans\"\s*:\s*([0-9]+)",
    ]
    for pattern in patterns:
        match = re.search(pattern, html)
        if match:
            return int(match.group(1))
    text_match = re.search(r"([0-9.,]+)\s+Followers", html, re.IGNORECASE)
    if text_match:
        parsed = _format_number_from_text(text_match.group(1))
        if parsed:
            return parsed
    return None


def _fetch_facebook_api(handle: str) -> Optional[int]:
    if not (ENABLE_SOCIAL_APIS and ENABLE_FB_API and FACEBOOK_ACCESS_TOKEN):
        return None
    page_id = FACEBOOK_ID_MAP.get(handle) or (handle if handle.isdigit() else None)
    if not page_id:
        return None
    params = {
        "fields": "fan_count",
        "access_token": FACEBOOK_ACCESS_TOKEN,
    }
    url = f"https://graph.facebook.com/v21.0/{page_id}"
    try:
        data = _http_get(url, params=params).json()
    except Exception as exc:
        logger.warning("Facebook API error for %s: %s", handle, exc)
        return None
    count = data.get("fan_count")
    if isinstance(count, int):
        return max(count, 0)
    try:
        return max(int(count), 0)
    except Exception:
        return None


def _fetch_facebook_scrape(handle: str) -> Optional[int]:
    slug = handle.strip('@')
    urls = [
        f"https://m.facebook.com/{slug}",
        f"https://m.facebook.com/{slug}/about",  # fallback view
    ]
    html = ""
    for url in urls:
        try:
            html = _http_get(url).text
            if html:
                break
        except Exception as exc:  # pragma: no cover
            logger.warning("Facebook scrape attempt failed for %s via %s: %s", handle, url, exc)
    if not html:
        return None
    match = re.search(r"([0-9.,]+)\s+(?:people\s+)?follow", html, re.IGNORECASE)
    if match:
        parsed = _format_number_from_text(match.group(1))
        if parsed:
            return parsed
    return None


FETCHERS = {
    "youtube": (_fetch_youtube_api, _fetch_youtube_scrape),
    "instagram": (_fetch_instagram_api, _fetch_instagram_scrape),
    "tiktok": (_fetch_tiktok_api, _fetch_tiktok_scrape),
    "facebook": (_fetch_facebook_api, _fetch_facebook_scrape),
}


def _run_stage(fetcher, handles: List[str]) -> Tuple[Dict[str, int], Dict[str, str]]:
    results: Dict[str, int] = {}
    errors: Dict[str, str] = {}
    for handle in handles:
        try:
            count = fetcher(handle)
        except Exception as exc:  # pragma: no cover - defensive
            logger.warning("Fetcher raised for %s: %s", handle, exc)
            count = None
        if isinstance(count, int) and count >= 0:
            results[handle] = count
        else:
            errors[handle] = "missing"
    return results, errors


def get_social_stats(
    platform_alias: str,
    handles: Optional[Iterable[str]] = None,
) -> Optional[SocialStatsResponse]:
    platform = resolve_platform(platform_alias)
    if not platform:
        return None

    config_handles = get_social_handles().get(platform, [])
    resolved_handles = _normalise_handles(handles or config_handles)
    if not resolved_handles:
        resolved_handles = []

    cache_key = _format_cache_key(platform, resolved_handles or config_handles)
    cached = _get_cache(cache_key)
    if cached:
        return cached

    api_fetcher, scrape_fetcher = FETCHERS[platform]
    per_account: List[AccountStat] = []
    counts: Dict[str, int] = {}
    approximate_handles: set[str] = set()

    handles_to_query = resolved_handles or config_handles
    handles_to_query = _normalise_handles(handles_to_query)

    api_results: Dict[str, int] = {}
    if ENABLE_SOCIAL_APIS:
        api_results, api_errors = _run_stage(api_fetcher, handles_to_query)
    else:
        api_errors = {handle: "disabled" for handle in handles_to_query}

    missing_handles = [h for h in handles_to_query if h not in api_results]

    scrape_results: Dict[str, int] = {}
    scrape_errors: Dict[str, str] = {}
    if missing_handles and ENABLE_SOCIAL_SCRAPER:
        scrape_results, scrape_errors = _run_stage(scrape_fetcher, missing_handles)

    for handle in handles_to_query:
        if handle in api_results:
            count = api_results[handle]
            counts[handle] = count
            per_account.append(AccountStat(handle=handle, count=count, source="api"))
        elif handle in scrape_results:
            count = scrape_results[handle]
            counts[handle] = count
            approximate_handles.add(handle)
            per_account.append(
                AccountStat(
                    handle=handle,
                    count=count,
                    source="scrape",
                    approximate=True,
                )
            )
        else:
            error_reason = None
            if handle in scrape_errors:
                error_reason = "scrape-failed"
            elif handle in api_errors:
                error_reason = api_errors[handle]
            per_account.append(
                AccountStat(
                    handle=handle,
                    count=None,
                    source="none",
                    error=error_reason,
                )
            )

    total_count = sum(counts.values()) if counts else None
    approximate = bool(approximate_handles)
    overall_source = "none"
    if counts:
        overall_source = "scrape" if approximate or not api_results else "api"

    response = SocialStatsResponse(
        platform=platform,
        per_account=per_account,
        totals={
            "count": total_count,
            "accounts": len(handles_to_query),
        },
        source=overall_source,
        handles=handles_to_query,
    )

    _store_cache(cache_key, response)
    return response


def get_social_overview() -> Dict[str, SocialStatsResponse]:
    results: Dict[str, SocialStatsResponse] = {}
    flags = get_platform_flags()
    for alias, platform in PLATFORM_CODES.items():
        if alias != platform:
            continue
        if not flags.get(platform, False):
            continue
        stats = get_social_stats(platform)
        if stats:
            results[platform] = stats
    return results

