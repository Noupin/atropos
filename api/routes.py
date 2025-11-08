"""Route registrations for the Flask application."""

from __future__ import annotations

from typing import Iterable, List

from flask import Blueprint, Flask, jsonify, request

from .config import EMAIL_RE
from .emailer import build_unsubscribe_link, generate_unsubscribe_token, send_welcome_email
from .rate_limit import RateLimiter
from .social_pipeline import SocialPipeline, UnsupportedPlatformError
from .storage import load_subscribers, load_tokens, save_subscribers, save_tokens


def _normalize_handles(raw: Iterable[str]) -> List[str]:
    handles: List[str] = []
    for value in raw:
        if not value:
            continue
        handle = value.strip()
        if not handle or handle in handles:
            continue
        handles.append(handle)
    return handles


def register_routes(app: Flask, social_pipeline: SocialPipeline, rate_limiter: RateLimiter) -> None:
    """Register all API routes on the provided Flask application."""

    bp = Blueprint("api", __name__)

    @bp.get("/health")
    def health():  # type: ignore[unused-ignore]
        return jsonify({"status": "ok"}), 200

    @bp.get("/api/social/overview")
    def social_overview():  # type: ignore[unused-ignore]
        payload = social_pipeline.get_overview()
        return jsonify(payload), 200

    @bp.get("/api/social/config")
    def social_config():  # type: ignore[unused-ignore]
        payload = social_pipeline.get_config()
        return jsonify(payload), 200

    @bp.get("/api/social/stats")
    def social_stats():  # type: ignore[unused-ignore]
        platform = (request.args.get("platform") or "").strip().lower()
        handle = (request.args.get("handle") or "").strip()
        if not platform or not handle:
            return jsonify({"error": "platform and handle are required"}), 400
        try:
            payload = social_pipeline.get_platform_stats(platform, [handle])
        except UnsupportedPlatformError as exc:  # pragma: no cover - defensive
            return jsonify({"error": str(exc)}), 400
        return jsonify(payload), 200

    @bp.get("/api/social/stats/batch")
    def social_stats_batch():  # type: ignore[unused-ignore]
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
        except UnsupportedPlatformError as exc:  # pragma: no cover - defensive
            return jsonify({"error": str(exc)}), 400
        return jsonify(payload), 200

    @bp.post("/subscribe")
    def subscribe():  # type: ignore[unused-ignore]
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

        subscribers = load_subscribers()
        if email in subscribers:
            app.logger.info("Duplicate subscribe ignored for %s", email)
            return jsonify({"ok": True, "duplicate": True})

        subscribers.append(email)
        save_subscribers(subscribers)

        tokens = load_tokens()
        token = generate_unsubscribe_token()
        tokens[token] = email
        save_tokens(tokens)

        unsub_link = build_unsubscribe_link(token)
        try:
            send_welcome_email(app.logger, email, unsub_link)
        except Exception as exc:  # pragma: no cover - external dependency
            app.logger.exception("Failed to send email to %s: %s", email, exc)

        return jsonify({"ok": True})

    @bp.get("/unsubscribe")
    def unsubscribe():  # type: ignore[unused-ignore]
        token = (request.args.get("token") or "").strip()
        tokens = load_tokens()
        email = tokens.pop(token, None)
        if not email:
            return jsonify({"ok": False, "error": "Invalid token"}), 400
        save_tokens(tokens)

        subscribers = load_subscribers()
        if email in subscribers:
            subscribers.remove(email)
            save_subscribers(subscribers)
            app.logger.info("Unsubscribed %s", email)
        return jsonify({"ok": True})

    app.register_blueprint(bp)


__all__ = ["register_routes"]
