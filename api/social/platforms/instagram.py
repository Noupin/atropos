from __future__ import annotations

import json
import os
import re
from typing import Optional, Tuple

from requests import RequestException, Response

from ..context import PlatformContext
from ..models import AccountStats
from ..settings import SCRAPER_TIMEOUT_SECONDS

INSTAGRAM_LD_JSON_RE = re.compile(
    r"<script type=\"application/ld\+json\">(\{.*?\})</script>",
    re.DOTALL | re.IGNORECASE,
)


def resolve(handle: str, context: PlatformContext) -> AccountStats:
    access_token = os.environ.get("SOCIAL_INSTAGRAM_ACCESS_TOKEN")
    user_id = os.environ.get("SOCIAL_INSTAGRAM_USER_ID")
    if access_token and user_id:
        api_result = _fetch_instagram_api(user_id, access_token, handle, context)
        if api_result.count is not None:
            return api_result
    return _fetch_instagram_scrape(handle, context)


def _fetch_instagram_api(
    user_id: str, access_token: str, handle: str, context: PlatformContext
) -> AccountStats:
    url = f"https://graph.facebook.com/v17.0/{user_id}"
    params = {"fields": "followers_count", "access_token": access_token}
    try:
        response = context.session.get(
            url, params=params, timeout=SCRAPER_TIMEOUT_SECONDS
        )
        status = response.status_code
        context.logger.info(
            "instagram handle=%s attempt=api url=%s status=%s",
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
        context.logger.info("instagram handle=%s attempt=api error=%s", handle, exc)
        return AccountStats(
            handle=handle,
            count=None,
            fetched_at=context.now(),
            source="api",
            error=str(exc),
        )
    count = payload.get("followers_count")
    if isinstance(count, int):
        context.logger.info(
            "instagram handle=%s attempt=api parse=followers_count count=%s",
            handle,
            count,
        )
        return AccountStats(
            handle=handle,
            count=count,
            fetched_at=context.now(),
            source="api",
        )
    return AccountStats(
        handle=handle,
        count=None,
        fetched_at=context.now(),
        source="api",
        error="Missing followers_count",
    )


def _fetch_instagram_scrape(handle: str, context: PlatformContext) -> AccountStats:
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
                "X-IG-App-ID": context.instagram_web_app_id,
                "Referer": "https://www.instagram.com/",
            }
        response = context.request(url, "instagram", handle, attempt, headers=headers)
        body = response.text if isinstance(response, Response) and response.ok else ""
        count, source = _parse_instagram_payload(body, handle, attempt, url, context)
        if count is not None:
            return AccountStats(
                handle=handle,
                count=count,
                fetched_at=context.now(),
                source=f"scrape:{source}",
            )
        if attempt == "direct":
            proxy_body = context.fetch_text(url, "instagram", handle)
            count, source = _parse_instagram_payload(
                proxy_body or "", handle, "text-proxy", url, context
            )
            if count is not None:
                return AccountStats(
                    handle=handle,
                    count=count,
                    fetched_at=context.now(),
                    source=f"scrape:{source}",
                )
    return AccountStats(
        handle=handle,
        count=None,
        fetched_at=context.now(),
        source="scrape",
        error="Missing followers",
    )


def _parse_instagram_payload(
    payload: str,
    handle: str,
    attempt: str,
    url: str,
    context: PlatformContext,
) -> Tuple[Optional[int], str]:
    if not payload:
        context.logger.info(
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
                context.logger.info(
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
                context.logger.info(
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
                            context.logger.info(
                                "instagram handle=%s attempt=%s parse=ld-json count=%s",
                                handle,
                                attempt,
                                count,
                            )
                            return count, f"{attempt}:ld-json"
    context.logger.info(
        "instagram handle=%s attempt=%s url=%s parse=miss",
        handle,
        attempt,
        url,
    )
    return None, attempt
