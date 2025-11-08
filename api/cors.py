"""CORS helper utilities."""

from __future__ import annotations

from flask import Flask, Response, request

from .config import (
    CORS_ALLOW_HEADERS,
    CORS_ALLOW_METHODS,
    CORS_ALLOW_ORIGINS,
    CORS_MAX_AGE,
)


def _origin_allowed(origin: str | None) -> bool:
    if not origin:
        return False
    if "*" in CORS_ALLOW_ORIGINS:
        return True
    return origin in CORS_ALLOW_ORIGINS


def apply_cors_headers(response: Response) -> Response:
    """Apply the configured CORS headers to the response when allowed."""

    origin = request.headers.get("Origin")
    if not _origin_allowed(origin):
        return response

    allow_all = "*" in CORS_ALLOW_ORIGINS
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

    response.headers["Access-Control-Allow-Methods"] = ", ".join(CORS_ALLOW_METHODS)

    requested_headers = request.headers.get("Access-Control-Request-Headers")
    if requested_headers:
        response.headers["Access-Control-Allow-Headers"] = requested_headers
    elif CORS_ALLOW_HEADERS:
        response.headers["Access-Control-Allow-Headers"] = ", ".join(CORS_ALLOW_HEADERS)

    response.headers["Access-Control-Max-Age"] = str(CORS_MAX_AGE)
    return response


def install_cors(app: Flask) -> None:
    """Install before/after hooks that apply CORS headers."""

    @app.before_request
    def _handle_preflight():  # type: ignore[unused-ignore]
        if request.method == "OPTIONS":
            response = app.make_response(("", 204))
            return apply_cors_headers(response)
        return None

    @app.after_request
    def _add_cors(response: Response):  # type: ignore[unused-ignore]
        return apply_cors_headers(response)


__all__ = ["apply_cors_headers", "install_cors"]
