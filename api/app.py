from __future__ import annotations

import logging
from typing import Iterable, List

from flask import Flask, Response, jsonify, request

from .emailer import send_welcome_email
from .rate_limit import RateLimiter
from .settings import ApiSettings, load_settings
from .social import SocialPipeline, UnsupportedPlatformError
from .storage import (
    ensure_initialized,
    generate_unsubscribe_token,
    load_subscribers,
    load_unsubscribe_tokens,
    save_subscribers,
    save_unsubscribe_tokens,
)
from .validators import EMAIL_RE

settings: ApiSettings = load_settings()
ensure_initialized(settings.storage)

app = Flask(__name__)

handler = logging.StreamHandler()
handler.setFormatter(logging.Formatter("[%(asctime)s] %(levelname)s: %(message)s"))
app.logger.setLevel(logging.INFO)
app.logger.addHandler(handler)
app.logger.info("Using data directory at %s", settings.storage.data_dir)

social_pipeline = SocialPipeline(data_dir=settings.storage.data_dir, logger=app.logger)
rate_limiter = RateLimiter(
    settings.rate_limit.window_seconds, settings.rate_limit.max_requests
)


def _origin_allowed(origin: str | None) -> bool:
    if not origin:
        return False
    if "*" in settings.cors.allow_origins:
        return True
    return origin in settings.cors.allow_origins


def _apply_cors_headers(response: Response) -> Response:
    origin = request.headers.get("Origin")
    if not _origin_allowed(origin):
        return response

    allow_all = "*" in settings.cors.allow_origins
    response.headers["Access-Control-Allow-Origin"] = "*" if allow_all else origin
    if not allow_all:
        vary = response.headers.get("Vary")
        if vary:
            vary_parts = [part.strip() for part in vary.split(",") if part.strip()]
            if "Origin" not in vary_parts:
                vary_parts.append("Origin")
            response.headers["Vary"] = ", ".join(vary_parts)
        else:
            response.headers["Vary"] = "Origin"

    response.headers["Access-Control-Allow-Methods"] = ", ".join(
        settings.cors.allow_methods
    )

    requested_headers = request.headers.get("Access-Control-Request-Headers")
    if requested_headers:
        response.headers["Access-Control-Allow-Headers"] = requested_headers
    elif settings.cors.allow_headers:
        response.headers["Access-Control-Allow-Headers"] = ", ".join(
            settings.cors.allow_headers
        )

    response.headers["Access-Control-Max-Age"] = str(settings.cors.max_age)
    return response


@app.before_request
def _handle_preflight():
    if request.method == "OPTIONS":
        response = app.make_response(("", 204))
        return _apply_cors_headers(response)
    return None


@app.after_request
def _add_cors(response: Response) -> Response:
    return _apply_cors_headers(response)


def _normalize_handles(raw: Iterable[str]) -> List[str]:
    handles: List[str] = []
    for value in raw:
        if not value:
            continue
        handle = value.strip()
        if not handle:
            continue
        if handle not in handles:
            handles.append(handle)
    return handles


@app.get("/health")
def health():
    return jsonify({"status": "ok"}), 200


@app.get("/api/social/overview")
def social_overview():
    payload = social_pipeline.get_overview()
    return jsonify(payload), 200


@app.get("/api/social/config")
def social_config():
    payload = social_pipeline.get_config()
    return jsonify(payload), 200


@app.get("/api/social/stats")
def social_stats():
    platform = (request.args.get("platform") or "").strip().lower()
    handle = (request.args.get("handle") or "").strip()
    if not platform or not handle:
        return jsonify({"error": "platform and handle are required"}), 400
    try:
        payload = social_pipeline.get_platform_stats(platform, [handle])
    except UnsupportedPlatformError as exc:
        return jsonify({"error": str(exc)}), 400
    return jsonify(payload), 200


@app.get("/api/social/stats/batch")
def social_stats_batch():
    platform = (request.args.get("platform") or "").strip().lower()
    if not platform:
        return jsonify({"error": "platform is required"}), 400

    handles_param = request.args.get("handles") or ""
    split_handles = [value for value in handles_param.split(",") if value]
    handles = _normalize_handles(request.args.getlist("handle"))
    handles.extend(split_handles)
    normalized = _normalize_handles(handles)
    if not normalized:
        return jsonify({"error": "at least one handle must be provided"}), 400

    try:
        payload = social_pipeline.get_platform_stats(platform, normalized)
    except UnsupportedPlatformError as exc:
        return jsonify({"error": str(exc)}), 400
    return jsonify(payload), 200


@app.post("/subscribe")
def subscribe():
    ip = request.headers.get("X-Forwarded-For", request.remote_addr) or "?"
    app.logger.info("/subscribe from %s", ip)
    if not rate_limiter.allow(ip):
        app.logger.warning("Rate limited: %s", ip)
        return jsonify({"ok": False, "error": "Too many requests"}), 429

    data = request.get_json(silent=True) or {}
    email = (data.get("email") or "").strip().lower()
    if not EMAIL_RE.match(email):
        app.logger.warning("Invalid email: %r", email)
        return jsonify({"ok": False, "error": "Invalid email"}), 400

    subs = load_subscribers(settings.storage)
    if email in subs:
        app.logger.info("Duplicate subscribe ignored for %s", email)
        return jsonify({"ok": True, "duplicate": True})

    subs.append(email)
    save_subscribers(settings.storage, subs)

    tokens = load_unsubscribe_tokens(settings.storage)
    token = generate_unsubscribe_token()
    tokens[token] = email
    save_unsubscribe_tokens(settings.storage, tokens)

    unsub_link = f"{settings.storage.base_url}/api/unsubscribe?token={token}"
    try:
        send_welcome_email(
            settings.smtp,
            settings.storage.base_url,
            email,
            unsub_link,
            app.logger,
        )
    except Exception as exc:  # pragma: no cover - logging path
        app.logger.exception("Failed to send email to %s: %s", email, exc)

    return jsonify({"ok": True})


@app.get("/unsubscribe")
def unsubscribe():
    token = (request.args.get("token") or "").strip()
    tokens = load_unsubscribe_tokens(settings.storage)
    email = tokens.pop(token, None)
    if not email:
        return jsonify({"ok": False, "error": "Invalid token"}), 400
    save_unsubscribe_tokens(settings.storage, tokens)

    subs = load_subscribers(settings.storage)
    if email in subs:
        subs.remove(email)
        save_subscribers(settings.storage, subs)
        app.logger.info("Unsubscribed %s", email)
    return jsonify({"ok": True})
