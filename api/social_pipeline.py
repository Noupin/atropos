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
SCRAPER_RESPECT_PROXIES = _env_flag("SOCIAL_SCRAPER_RESPECT_PROXIES", True)

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


def _http_get(
    url: str,
    params: Optional[Dict[str, str]] = None,
    *,
    headers: Optional[Dict[str, str]] = None,
    allow_redirects: bool = True,
) -> requests.Response:
    session = requests.Session()
    session.trust_env = SCRAPER_RESPECT_PROXIES
    session.headers.update(
        {
            "User-Agent": USER_AGENT,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.8",
            "Accept-Encoding": "gzip, deflate, br",
        }
    )
    if headers:
        session.headers.update(headers)
    last_exc: Optional[Exception] = None
    for attempt in range(1, SCRAPER_RETRIES + 2):
        try:
            logger.debug(
                "Fetching URL %s (attempt %s, params=%s, trust_env=%s)",
                url,
                attempt,
                params,
                session.trust_env,
            )
            response = session.get(
                url,
                params=params,
                timeout=SCRAPER_TIMEOUT_SECONDS,
                allow_redirects=allow_redirects,
            )
            response.raise_for_status()
            status_code = getattr(response, "status_code", "unknown")
            if hasattr(response, "content") and getattr(response, "content") is not None:
                body_length = len(response.content)  # type: ignore[arg-type]
            elif hasattr(response, "text") and getattr(response, "text") is not None:
                body_length = len(response.text)  # type: ignore[arg-type]
            else:
                body_length = 0
            logger.debug(
                "Fetched %s status=%s length=%s", url, status_code, body_length
            )
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
        url = f"https://www.youtube.com/channel/{cleaned}/about?hl=en"
    else:
        url = f"https://www.youtube.com/@{cleaned.lstrip('@')}/about?hl=en"
    try:
        html = _http_get(url).text
    except Exception as exc:  # pragma: no cover - network variability
        logger.warning("YouTube scrape failed for %s: %s", handle, exc)
        return None
    logger.info("Fetched YouTube about page for %s (%s chars)", handle, len(html))
    patterns = [
        (
            r"\"subscriberCountText\"\s*:\s*{.*?\"simpleText\""
            r"\s*:\s*\"([^\"]+)\""
        ),
        (
            r"\"subscriberCountText\"\s*:\s*{.*?\"runs\"\s*:\s*\["
            r".*?\"text\"\s*:\s*\"([^\"]+)\""
        ),
        r"\"approximateSubscriberCountText\"\s*:\s*\{.*?\"simpleText\"\s*:\s*\"([^\"]+)\"",
        r"\"subscribersText\"\s*:\s*\{.*?\"simpleText\"\s*:\s*\"([^\"]+)\"",
    ]
    for pattern in patterns:
        match = re.search(pattern, html, re.IGNORECASE | re.DOTALL)
        if match:
            parsed = _format_number_from_text(match.group(1))
            if parsed:
                return parsed
    logger.info("YouTube scrape could not locate subscriber pattern for %s", handle)
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
    username = handle.strip("@")
    json_headers = {
        "User-Agent": (
            "Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) "
            "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.5 "
            "Mobile/15E148 Safari/604.1"
        ),
        "Referer": f"https://www.instagram.com/{username}/",
        "x-ig-app-id": "936619743392459",
        "Accept": "application/json",
    }
    try:
        response = _http_get(
            "https://www.instagram.com/api/v1/users/web_profile_info/",
            params={"username": username},
            headers=json_headers,
        )
        data = response.json()
        keys = list(data.keys()) if isinstance(data, dict) else "<non-dict>"
        logger.debug("Instagram JSON payload for %s: keys=%s", handle, keys)
        user = data.get("data", {}).get("user")
        if isinstance(user, dict):
            candidates = [
                user.get("edge_followed_by", {}).get("count"),
                user.get("follower_count"),
                user.get("followers_count"),
            ]
            for candidate in candidates:
                if candidate is None:
                    continue
                try:
                    parsed = int(str(candidate).replace(",", ""))
                except (TypeError, ValueError):
                    parsed = _format_number_from_text(str(candidate))
                if parsed is not None:
                    logger.info(
                        "Instagram JSON scrape succeeded for %s with count=%s",
                        handle,
                        parsed,
                    )
                    return parsed
        logger.info("Instagram JSON scrape missing count fields for %s", handle)
    except Exception as exc:  # pragma: no cover - network variability
        logger.warning("Instagram JSON scrape failed for %s: %s", handle, exc)

    url = f"https://www.instagram.com/{username}/?__a=1&__d=dis"
    try:
        html = _http_get(
            url,
            headers={
                "Accept": "application/json",
                "Referer": f"https://www.instagram.com/{username}/",
            },
        ).text
    except Exception as exc:  # pragma: no cover - network variability
        logger.warning("Instagram fallback scrape failed for %s: %s", handle, exc)
        return None
    logger.info("Fetched Instagram fallback payload for %s (%s chars)", handle, len(html))
    patterns = [
        r"\"edge_followed_by\"\s*:\s*\{.*?\"count\"\s*:\s*([0-9.,KMB]+)",
        r"\"follower_count\"\s*:\s*([0-9.,KMB]+)",
        r"content=\"([0-9.,]+) followers",
        r"followers_count\"\s*:\s*([0-9.,KMB]+)",
    ]
    for pattern in patterns:
        match = re.search(pattern, html, re.IGNORECASE | re.DOTALL)
        if not match:
            continue
        parsed = _format_number_from_text(match.group(1))
        if parsed is not None:
            return parsed
        try:
            return int(match.group(1))
        except ValueError:
            continue
    logger.info("Instagram scrape could not locate follower pattern for %s", handle)
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
    logger.info("Fetched TikTok profile page for %s (%s chars)", handle, len(html))
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
    logger.info("TikTok scrape could not locate follower pattern for %s", handle)
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
    logger.info("Fetched Facebook mobile page for %s (%s chars)", handle, len(html))
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
            logger.warning(
                "Fetcher %s raised for %s: %s", getattr(fetcher, "__name__", fetcher), handle, exc,
                exc_info=True,
            )
            errors[handle] = "exception"
            continue
        if isinstance(count, int) and count >= 0:
            results[handle] = count
            logger.info(
                "Fetcher %s succeeded for %s with count %s",
                getattr(fetcher, "__name__", fetcher),
                handle,
                count,
            )
        else:
            errors[handle] = "missing"
            logger.info(
                "Fetcher %s returned no data for %s", getattr(fetcher, "__name__", fetcher), handle
            )
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
        logger.info(
            "Cache hit for %s handles=%s source=%s total=%s",
            platform,
            cached.handles,
            cached.source,
            cached.totals.get("count"),
        )
        return cached

    api_fetcher, scrape_fetcher = FETCHERS[platform]
    per_account: List[AccountStat] = []
    counts: Dict[str, int] = {}
    approximate_handles: set[str] = set()

    handles_to_query = resolved_handles or config_handles
    handles_to_query = _normalise_handles(handles_to_query)

    logger.info(
        "Resolving social stats for %s with handles=%s (apis_enabled=%s scraper_enabled=%s)",
        platform,
        handles_to_query,
        ENABLE_SOCIAL_APIS,
        ENABLE_SOCIAL_SCRAPER,
    )

    api_results: Dict[str, int] = {}
    if ENABLE_SOCIAL_APIS:
        api_results, api_errors = _run_stage(api_fetcher, handles_to_query)
    else:
        api_errors = {handle: "disabled" for handle in handles_to_query}

    logger.info(
        "API stage finished for %s: successes=%s errors=%s",
        platform,
        list(api_results.items()),
        api_errors,
    )

    missing_handles = [h for h in handles_to_query if h not in api_results]

    scrape_results: Dict[str, int] = {}
    scrape_errors: Dict[str, str] = {}
    if missing_handles and ENABLE_SOCIAL_SCRAPER:
        scrape_results, scrape_errors = _run_stage(scrape_fetcher, missing_handles)

    logger.info(
        "Scrape stage finished for %s: successes=%s errors=%s",
        platform,
        list(scrape_results.items()),
        scrape_errors,
    )

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
    logger.info(
        "Resolved social stats for %s handles=%s source=%s total=%s",
        platform,
        handles_to_query,
        overall_source,
        total_count,
    )
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

