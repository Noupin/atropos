from __future__ import annotations

"""Flask routes for social follower/subscriber statistics."""

from typing import List, Optional

from flask import Blueprint, jsonify, request

try:  # pragma: no cover - allow execution without package context
    from .social_config import get_social_config
    from .social_pipeline import (
        AccountStat,
        SocialStatsResponse,
        get_social_overview,
        get_social_stats,
        resolve_platform,
    )
except ImportError:  # pragma: no cover - fallback when module loaded as script
    from social_config import get_social_config
    from social_pipeline import (
        AccountStat,
        SocialStatsResponse,
        get_social_overview,
        get_social_stats,
        resolve_platform,
    )


blueprint = Blueprint("social", __name__, url_prefix="/api/social")


def _serialise_account(stat: AccountStat) -> dict:
    return {
        "handle": stat.handle,
        "count": stat.count,
        "source": stat.source,
        "approximate": stat.approximate,
        "error": stat.error,
    }


def _serialise_stats(stats: Optional[SocialStatsResponse]) -> dict:
    if not stats:
        return {
            "platform": None,
            "perAccount": [],
            "totals": {"count": None, "accounts": 0},
            "source": "none",
            "handles": [],
        }
    return {
        "platform": stats.platform,
        "handles": stats.handles,
        "perAccount": [_serialise_account(item) for item in stats.per_account],
        "totals": stats.totals,
        "source": stats.source,
        "approximate": stats.source == "scrape",
    }


@blueprint.get("/config")
def social_config():
    return jsonify(get_social_config())


@blueprint.get("/stats")
def social_stats():
    platform_raw = request.args.get("platform", "")
    handles_raw = request.args.get("handles", "")
    handles: List[str] = []
    if handles_raw:
        handles = [segment.strip() for segment in handles_raw.split(",") if segment.strip()]

    stats = get_social_stats(platform_raw, handles)
    if stats is None:
        return (
            jsonify(
                {
                    "platform": resolve_platform(platform_raw) or platform_raw or None,
                    "source": "none",
                    "error": "unknown-platform",
                    "perAccount": [],
                    "totals": {"count": None, "accounts": 0},
                    "handles": handles,
                }
            ),
            200,
        )
    return jsonify(_serialise_stats(stats))


@blueprint.get("/overview")
def social_overview():
    overview = get_social_overview()
    payload = {platform: _serialise_stats(stats) for platform, stats in overview.items()}
    grand_total = 0
    approximate = False
    for stats in overview.values():
        count = stats.totals.get("count") if stats.totals else None
        if isinstance(count, int):
            grand_total += count
        if stats.source == "scrape":
            approximate = True
    return jsonify(
        {
            "platforms": payload,
            "grandTotal": grand_total if grand_total > 0 else None,
            "approximate": approximate,
        }
    )


@blueprint.after_request
def _add_local_dev_cors_headers(response):
    origin = request.headers.get("Origin")
    if not origin:
        return response

    allowed_prefixes = ("http://localhost", "http://127.0.0.1")
    if origin.startswith(allowed_prefixes):
        response.headers["Access-Control-Allow-Origin"] = origin
        existing_vary = response.headers.get("Vary")
        if existing_vary:
            vary_values = {segment.strip() for segment in existing_vary.split(",") if segment.strip()}
            if "Origin" not in vary_values:
                response.headers["Vary"] = f"{existing_vary}, Origin"
        else:
            response.headers["Vary"] = "Origin"
    return response

