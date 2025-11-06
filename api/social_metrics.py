"""Social metric scraping fallback endpoints."""
from __future__ import annotations

import math
import re
from dataclasses import dataclass
from typing import Iterable, Optional

import requests
from flask import Blueprint, jsonify, request, current_app

USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/120.0.0.0 Safari/537.36"
)

TIMEOUT_SECONDS = 10


@dataclass
class ScrapeTask:
    url: str
    pattern: Optional[str]

social_metrics_bp = Blueprint("social_metrics", __name__, url_prefix="/social-metrics")


def _normalize_count(raw: str) -> Optional[int]:
    if not raw:
        return None
    cleaned = raw.strip()
    match = re.match(r"(?P<number>[0-9.,]+)(?P<suffix>[KMB]?)", cleaned, re.IGNORECASE)
    if not match:
        return None
    number = match.group("number").replace(",", "")
    try:
        value = float(number)
    except ValueError:
        return None
    suffix = match.group("suffix").upper()
    multiplier = {"": 1, "K": 1_000, "M": 1_000_000, "B": 1_000_000_000}.get(suffix)
    if multiplier is None:
        return None
    scaled = value * multiplier
    if not math.isfinite(scaled) or scaled < 0:
        return None
    return int(round(scaled))


def _apply_pattern(pattern: str, html: str) -> Optional[int]:
    try:
        compiled = re.compile(pattern, re.IGNORECASE | re.MULTILINE)
    except re.error:
        return None
    match = compiled.search(html)
    if not match:
        return None
    if match.groupdict():
        for key in ("count", "value", "followers", "subscribers"):
            if key in match.groupdict():
                normalized = _normalize_count(match.group(key))
                if normalized is not None:
                    return normalized
    groups = [g for g in match.groups() if g is not None]
    for group in groups:
        normalized = _normalize_count(group)
        if normalized is not None:
            return normalized
    return None


def _extract_with_heuristics(platform: str, html: str) -> Optional[int]:
    platform = (platform or "").lower().strip()
    if not platform:
        return None

    patterns: dict[str, Iterable[str]] = {
        "youtube": (
            r'"subscriberCountText"\s*:\s*\{"simpleText"\s*:\s*"([^"]+)"',
            r'([0-9.,]+)\s+subscribers',
            r'"approxSubscriberCount"\s*:\s*"([0-9.,KMB]+)"',
        ),
        "instagram": (
            r'"edge_followed_by"\s*:\s*\{"count"\s*:\s*([0-9]+)\}',
            r'"follower_count"\s*:\s*([0-9]+)',
        ),
        "facebook": (
            r'"fan_count"\s*:\s*([0-9]+)',
            r'"page_fan_count"\s*:\s*([0-9]+)',
        ),
        "tiktok": (
            r'"followers":\s*([0-9]+)',
            r'"followerCount":\s*([0-9]+)',
            r'([0-9.,]+)\s+Followers',
        ),
    }

    for pattern in patterns.get(platform, ()):  # type: ignore[assignment]
        result = _apply_pattern(pattern, html)
        if result is not None:
            return result
    return None


def _scrape_count(task: ScrapeTask, platform: str) -> Optional[int]:
    headers = {"User-Agent": USER_AGENT}
    response = requests.get(task.url, headers=headers, timeout=TIMEOUT_SECONDS)
    response.raise_for_status()
    html = response.text
    if task.pattern:
        value = _apply_pattern(task.pattern, html)
        if value is not None:
            return value
    return _extract_with_heuristics(platform, html)


def _validate_payload(payload: dict) -> tuple[str, list[ScrapeTask]]:
    platform = str(payload.get("platform", "")).strip().lower()
    if not platform:
        raise ValueError("platform is required")

    accounts = payload.get("accounts")
    if not isinstance(accounts, list):
        raise ValueError("accounts must be a list")

    tasks: list[ScrapeTask] = []
    for account in accounts:
        if not isinstance(account, dict):
            continue
        url = str(account.get("url", "")).strip()
        if not url:
            continue
        pattern = account.get("pattern")
        if isinstance(pattern, str):
            pattern = pattern.strip()
            if not pattern:
                pattern = None
        else:
            pattern = None
        tasks.append(ScrapeTask(url=url, pattern=pattern))

    if not tasks:
        raise ValueError("no valid accounts provided")

    return platform, tasks


@social_metrics_bp.post("/scrape")
def scrape_social_metrics():
    payload = request.get_json(silent=True) or {}
    try:
        platform, tasks = _validate_payload(payload)
    except ValueError as error:
        return jsonify({"ok": False, "error": str(error)}), 400

    total = 0
    successes = 0
    errors: list[str] = []

    for task in tasks:
        try:
            count = _scrape_count(task, platform)
            if count is None:
                raise ValueError("count not found")
            total += count
            successes += 1
        except Exception as exc:  # noqa: BLE001
            message = f"{task.url}: {exc}"
            errors.append(message)
            current_app.logger.warning("Scrape fallback failed: %s", message)

    response_body = {
        "ok": successes > 0,
        "count": total if successes > 0 else None,
        "accountCount": successes,
        "errors": errors,
        "isMock": True,
    }

    status = 200 if successes > 0 else 502
    return jsonify(response_body), status
