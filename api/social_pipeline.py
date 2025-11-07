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
from urllib.parse import urlencode, urlparse

import requests

try:  # pragma: no cover - allow use without package installation
    from .social_config import get_platform_flags, get_social_handles
except ImportError:  # pragma: no cover - fallback for script execution
    from social_config import get_platform_flags, get_social_handles


logger = logging.getLogger("atropos.social")
if logger.level == logging.NOTSET:
    logger.setLevel(logging.INFO)


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
    text = value.strip().replace(",", "").replace("\u00a0", "")
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


def _extract_json_object(source: str, marker: str) -> Optional[dict]:
    """Extract a JSON object following ``marker`` inside a HTML/JS payload."""

    index = source.find(marker)
    if index == -1:
        return None
    start = source.find("{", index)
    if start == -1:
        return None
    depth = 0
    for pos in range(start, len(source)):
        char = source[pos]
        if char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                snippet = source[start : pos + 1]
                try:
                    return json.loads(snippet)
                except json.JSONDecodeError:
                    return None
    return None


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


def _fetch_text(url: str) -> str:
    """Fetch ``url`` via the text proxy to capture server-rendered markup."""

    parsed = urlparse(url)
    host = parsed.netloc
    path = parsed.path or "/"
    proxy_url = f"https://r.jina.ai/http://{host}{path}"
    if parsed.query:
        proxy_url = f"{proxy_url}?{parsed.query}"
    logger.debug("Fetching text proxy for %s via %s", url, proxy_url)
    response = _http_get(proxy_url)
    text = response.text or ""
    logger.info(
        "Fetched text proxy for %s via %s (%s chars)", url, proxy_url, len(text)
    )
    return text


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


def _first_text_run(payload: dict) -> Optional[str]:
    runs = payload.get("runs") if isinstance(payload, dict) else None
    if not isinstance(runs, list):
        return None
    for run in runs:
        if isinstance(run, dict) and run.get("text"):
            return str(run["text"])
    return None


def _youtube_text_candidates(value) -> List[str]:
    texts: List[str] = []
    if value is None:
        return texts
    if isinstance(value, str):
        texts.append(value)
    elif isinstance(value, dict):
        simple = value.get("simpleText")
        if simple:
            texts.append(str(simple))
        run = _first_text_run(value)
        if run:
            texts.append(run)
        runs = value.get("runs")
        if isinstance(runs, list):
            for entry in runs:
                if isinstance(entry, dict) and entry.get("text"):
                    texts.append(str(entry["text"]))
    elif isinstance(value, list):
        for item in value:
            texts.extend(_youtube_text_candidates(item))
    return texts


def _search_youtube_count(blob: dict, source_label: str) -> Tuple[Optional[int], Optional[str]]:
    stack: List[Tuple[str, object]] = [("", blob)]
    while stack:
        path, current = stack.pop()
        if isinstance(current, dict):
            for key in (
                "subscriberCountText",
                "approximateSubscriberCountText",
                "subscribersText",
            ):
                if key in current:
                    for candidate in _youtube_text_candidates(current[key]):
                        parsed = _format_number_from_text(candidate)
                        if parsed is not None:
                            label = (
                                f"{source_label}{'.' if path else ''}{path}.{key}"
                                if path
                                else f"{source_label}.{key}"
                            )
                            return parsed, label
            for key, value in current.items():
                next_path = f"{path}.{key}" if path else key
                stack.append((next_path, value))
        elif isinstance(current, list):
            for idx, value in enumerate(current):
                next_path = f"{path}[{idx}]" if path else f"[{idx}]"
                stack.append((next_path, value))
    return None, None


def _parse_youtube_html(html: str) -> Tuple[Optional[int], Dict[str, int], Optional[str]]:
    if not html:
        return None, {}, None
    html_normalized = html.replace("\u00a0", " ")
    extras: Dict[str, int] = {}

    data_candidates = [
        ("ytInitialData", _extract_json_object(html, "ytInitialData")),
        ("ytcfg", _extract_json_object(html, "ytcfg.set")),
        ("ytInitialPlayerResponse", _extract_json_object(html, "ytInitialPlayerResponse")),
    ]
    count: Optional[int] = None
    detail: Optional[str] = None
    for label, blob in data_candidates:
        if not isinstance(blob, dict):
            continue
        count, detail = _search_youtube_count(blob, label)
        if count is not None:
            break

    if count is None:
        patterns = [
            ("regex:subscribers", r"([0-9.,]+)\s+subscribers"),
        ]
        for pattern_label, pattern in patterns:
            match = re.search(pattern, html_normalized, re.IGNORECASE)
            if not match:
                continue
            parsed = _format_number_from_text(match.group(1))
            if parsed is not None:
                count = parsed
                detail = pattern_label
                break

    for extra_label, pattern in (
        ("videos", r"([0-9.,]+)\s+videos"),
        ("views", r"([0-9.,]+)\s+views"),
    ):
        match = re.search(pattern, html_normalized, re.IGNORECASE)
        if not match:
            continue
        parsed_extra = _format_number_from_text(match.group(1))
        if parsed_extra is not None:
            extras[extra_label] = parsed_extra

    return count, extras, detail



def _fetch_youtube_scrape(handle: str) -> Optional[int]:
    cleaned = handle.strip()
    is_channel_id = cleaned.startswith("UC")
    if is_channel_id:
        base_path = f"https://www.youtube.com/channel/{cleaned}"
    else:
        base_path = f"https://www.youtube.com/@{cleaned.lstrip('@')}"
    params = {"hl": "en", "gl": "US", "persist_hl": "1", "persist_gl": "1"}
    query = urlencode(params)
    about_base = f"{base_path}/about"
    root_base = base_path
    about_full = f"{about_base}?{query}"
    root_full = f"{root_base}?{query}"

    attempts: List[Tuple[str, str, bool, Optional[Dict[str, str]], str]] = [
        ("direct", about_base, False, params, about_full),
        ("text-proxy", about_full, True, None, about_full),
        ("text-proxy-root", root_full, True, None, root_full),
    ]

    for attempt_label, request_url, use_text_proxy, request_params, log_url in attempts:
        html = ""
        try:
            if use_text_proxy:
                html = _fetch_text(request_url)
                logger.info(
                    "Fetched YouTube page for %s via %s (%s chars) [%s]",
                    handle,
                    log_url,
                    len(html),
                    attempt_label,
                )
            else:
                response = _http_get(request_url, params=request_params)
                html = response.text or ""
                logger.info(
                    "Fetched YouTube page for %s via %s (%s chars)",
                    handle,
                    log_url,
                    len(html),
                )
        except Exception as exc:  # pragma: no cover - network variability
            logger.warning(
                "YouTube %s fetch failed for %s via %s: %s",
                attempt_label,
                handle,
                log_url,
                exc,
            )
            continue

        count, extras, detail = _parse_youtube_html(html)
        if count is None:
            logger.warning(
                "YouTube %s parse missing subscriber pattern for %s via %s",
                attempt_label,
                handle,
                log_url,
            )
            continue

        if extras:
            logger.info(
                "YouTube %s parse extras for %s: %s",
                attempt_label,
                handle,
                extras,
            )
        logger.info(
            "YouTube scrape succeeded for %s via %s (%s) count=%s detail=%s",
            handle,
            attempt_label,
            log_url,
            count,
            detail,
        )
        return count

    logger.warning("YouTube scrape could not locate subscriber pattern for %s", handle)
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
    username = handle.strip('@')
    url = f"https://www.tiktok.com/@{username}"
    headers = {
        'User-Agent': (
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
            '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36)'
        ),
        'Referer': 'https://www.tiktok.com/',
    }

    html_direct = ''
    try:
        response = _http_get(url, headers=headers)
        html_direct = response.text or ''
        logger.info(
            'Fetched TikTok profile page for %s via direct url=%s length=%s',
            handle,
            url,
            len(html_direct),
        )
    except Exception as exc:  # pragma: no cover - network variability
        logger.warning('TikTok direct fetch failed for %s via %s: %s', handle, url, exc)

    def parse_markup(markup: str) -> Tuple[Optional[int], Optional[str]]:
        if not markup:
            return None, None
        script_match = re.search(
            r'<script[^>]+id="SIGI_STATE"[^>]*>(.*?)</script>',
            markup,
            re.IGNORECASE | re.DOTALL,
        )
        if script_match:
            try:
                data = json.loads(script_match.group(1))
            except json.JSONDecodeError:
                data = None
            if isinstance(data, dict):
                user_module = data.get('UserModule', {})
                users = user_module.get('users', {}) if isinstance(user_module, dict) else {}
                stats = user_module.get('stats', {}) if isinstance(user_module, dict) else {}
                username_lower = username.lower()
                if isinstance(users, dict):
                    for key, info in users.items():
                        if not isinstance(info, dict):
                            continue
                        unique_id = str(info.get('uniqueId', '')).lower()
                        if key.lower() != username_lower and unique_id != username_lower:
                            continue
                        follower_value = info.get('followerCount')
                        if isinstance(follower_value, (int, float)):
                            return int(follower_value), 'json:users'
                        candidate_ids = []
                        for key_name in ('id', 'userId', 'uid'):
                            ident = info.get(key_name)
                            if ident:
                                candidate_ids.append(str(ident))
                        candidate_ids.extend([key, unique_id])
                        for candidate_id in candidate_ids:
                            if not candidate_id:
                                continue
                            stat_blob = stats.get(candidate_id) if isinstance(stats, dict) else None
                            if isinstance(stat_blob, dict):
                                follower_value = stat_blob.get('followerCount')
                                if isinstance(follower_value, (int, float)):
                                    return int(follower_value), 'json:stats'
                if isinstance(stats, dict):
                    for key, info in stats.items():
                        if not isinstance(info, dict):
                            continue
                        follower_value = info.get('followerCount')
                        if isinstance(follower_value, (int, float)):
                            return int(follower_value), 'json:stats-any'
        patterns = [
            ('json:followerCount', r'\"followerCount\"\s*:\s*([0-9]+)'),
            ('regex:followers', r'([0-9.,]+)\s+Followers'),
        ]
        for label, pattern in patterns:
            match = re.search(pattern, markup, re.IGNORECASE)
            if not match:
                continue
            parsed = _format_number_from_text(match.group(1))
            if parsed is not None:
                return parsed, label
        return None, None

    if html_direct:
        count, detail = parse_markup(html_direct)
        if count is not None:
            logger.info(
                'TikTok scrape succeeded for %s via direct (%s) count=%s detail=%s',
                handle,
                url,
                count,
                detail,
            )
            return count
        logger.warning('TikTok direct parse missing follower pattern for %s via %s', handle, url)

    proxy_html = ''
    try:
        proxy_html = _fetch_text(url)
        logger.info(
            'Fetched TikTok profile page via text proxy for %s url=%s length=%s',
            handle,
            url,
            len(proxy_html),
        )
    except Exception as exc:  # pragma: no cover - network variability
        logger.warning('TikTok text proxy fetch failed for %s via %s: %s', handle, url, exc)

    if proxy_html:
        count, detail = parse_markup(proxy_html)
        if count is not None:
            logger.info(
                'TikTok scrape succeeded for %s via text-proxy (%s) count=%s detail=%s',
                handle,
                url,
                count,
                detail,
            )
            return count
        logger.warning('TikTok text-proxy parse missing follower pattern for %s via %s', handle, url)

    logger.warning('TikTok scrape could not locate follower pattern for %s', handle)
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
    username = handle.strip('@')

    def _direct_headers(url: str) -> Dict[str, str]:
        if 'mbasic.facebook.com' in url:
            return {
                'User-Agent': (
                    'Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) '
                    'AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.5 '
                    'Mobile/15E148 Safari/604.1'
                ),
                'Referer': 'https://mbasic.facebook.com/',
            }
        return {
            'User-Agent': USER_AGENT,
            'Referer': 'https://www.facebook.com/',
        }

    attempts = [
        ('mbasic-direct', f'https://mbasic.facebook.com/{username}', False),
        ('mbasic-text-proxy', f'https://mbasic.facebook.com/{username}', True),
        ('www-direct', f'https://www.facebook.com/{username}', False),
        ('www-text-proxy', f'https://www.facebook.com/{username}', True),
    ]

    for label, url, use_text_proxy in attempts:
        html = ''
        try:
            if use_text_proxy:
                html = _fetch_text(url)
                logger.info(
                    'Fetched Facebook page for %s via %s (%s chars) [%s]',
                    handle,
                    url,
                    len(html),
                    label,
                )
            else:
                response = _http_get(url, headers=_direct_headers(url))
                html = response.text or ''
                logger.info(
                    'Fetched Facebook page for %s via %s (%s chars)',
                    handle,
                    url,
                    len(html),
                )
        except Exception as exc:  # pragma: no cover - network variability
            logger.warning('Facebook %s fetch failed for %s via %s: %s', label, handle, url, exc)
            continue
        if not html:
            logger.warning('Facebook %s fetch returned empty content for %s via %s', label, handle, url)
            continue
        parsed = _parse_facebook_followers(html)
        if parsed is not None:
            logger.info(
                'Facebook scrape succeeded for %s via %s (%s) count=%s',
                handle,
                label,
                url,
                parsed,
            )
            return parsed
        logger.warning('Facebook %s parse missing follower pattern for %s via %s', label, handle, url)

    logger.warning('Facebook scrape could not locate follower pattern for %s', handle)
    return None



def _parse_facebook_followers(html: str) -> Optional[int]:
    patterns = [
        r"([0-9.,]+)\s+(?:people\s+)?follow this",
        r"([0-9.,]+)\s+followers",
        r"\"fan_count\"\s*:\s*([0-9]+)",
        r"page_fans\"\s*:\s*\{[^}]*?\"count\"\s*:\s*([0-9]+)",
    ]
    for pattern in patterns:
        match = re.search(pattern, html, re.IGNORECASE | re.DOTALL)
        if not match:
            continue
        parsed = _format_number_from_text(match.group(1))
        if parsed is not None:
            return parsed
    return None


FETCHERS = {
    "youtube": (_fetch_youtube_api, _fetch_youtube_scrape),
    "instagram": (_fetch_instagram_api, _fetch_instagram_scrape),
    "tiktok": (_fetch_tiktok_api, _fetch_tiktok_scrape),
    "facebook": (_fetch_facebook_api, _fetch_facebook_scrape),
}


def _run_stage(
    fetcher,
    handles: List[str],
    *,
    stage: str,
) -> Tuple[Dict[str, int], Dict[str, str]]:
    results: Dict[str, int] = {}
    errors: Dict[str, str] = {}
    for handle in handles:
        try:
            count = fetcher(handle)
        except Exception as exc:  # pragma: no cover - defensive
            logger.warning(
                "%s stage fetcher %s raised for %s: %s",
                stage,
                getattr(fetcher, "__name__", fetcher),
                handle,
                exc,
                exc_info=True,
            )
            errors[handle] = "exception"
            continue
        if isinstance(count, int) and count >= 0:
            results[handle] = count
            logger.info(
                "%s stage fetcher %s succeeded for %s with count %s",
                stage,
                getattr(fetcher, "__name__", fetcher),
                handle,
                count,
            )
        else:
            errors[handle] = "missing"
            logger.warning(
                "%s stage fetcher %s returned no data for %s",
                stage,
                getattr(fetcher, "__name__", fetcher),
                handle,
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
        api_results, api_errors = _run_stage(
            api_fetcher,
            handles_to_query,
            stage="api",
        )
    else:
        api_errors = {handle: "disabled" for handle in handles_to_query}
        logger.warning(
            "API stage disabled for %s; marking handles as unavailable: %s",
            platform,
            handles_to_query,
        )

    logger.info(
        "API stage finished for %s: successes=%s errors=%s",
        platform,
        list(api_results.items()),
        api_errors,
    )
    if api_errors:
        logger.warning(
            "API stage reported errors for %s: %s",
            platform,
            api_errors,
        )

    missing_handles = [h for h in handles_to_query if h not in api_results]

    scrape_results: Dict[str, int] = {}
    scrape_errors: Dict[str, str] = {}
    if missing_handles and ENABLE_SOCIAL_SCRAPER:
        scrape_results, scrape_errors = _run_stage(
            scrape_fetcher,
            missing_handles,
            stage="scrape",
        )
    elif missing_handles:
        scrape_errors = {handle: "disabled" for handle in missing_handles}
        logger.warning(
            "Scrape stage disabled for %s; remaining handles=%s",
            platform,
            missing_handles,
        )

    logger.info(
        "Scrape stage finished for %s: successes=%s errors=%s",
        platform,
        list(scrape_results.items()),
        scrape_errors,
    )
    if scrape_errors:
        logger.warning(
            "Scrape stage reported errors for %s: %s",
            platform,
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
            logger.warning(
                "No data resolved for %s handle %s (api=%s scrape=%s)",
                platform,
                handle,
                api_errors.get(handle),
                scrape_errors.get(handle),
            )
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

