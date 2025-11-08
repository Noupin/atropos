"""Configuration helpers and constants for the Atropos API service."""

from __future__ import annotations

import os
import re
from pathlib import Path
from typing import Iterable


def _resolve_data_dir() -> Path:
    """Return the writable data directory based on the runtime environment."""

    override = os.environ.get("DATA_DIR")
    if override:
        data_dir = Path(override)
    else:
        in_docker = os.environ.get("IN_DOCKER") == "1" or Path("/.dockerenv").exists()
        data_dir = Path("/data") if in_docker else Path(__file__).resolve().parents[1] / "data"
    data_dir.mkdir(parents=True, exist_ok=True)
    return data_dir


def _parse_csv(name: str, default: Iterable[str]) -> list[str]:
    raw = os.environ.get(name)
    if raw is None:
        return list(default)
    values = [item.strip() for item in raw.split(",") if item.strip()]
    return values or list(default)


DATA_DIR = _resolve_data_dir()

SUBSCRIBERS = Path(os.environ.get("SUBSCRIBERS_FILE", str(DATA_DIR / "subscribers.json")))
UNSUB_TOKENS = Path(os.environ.get("UNSUB_TOKENS_FILE", str(DATA_DIR / "unsub_tokens.json")))
BASE_URL = os.environ.get("PUBLIC_BASE_URL", "https://atropos-video.com")

CORS_ALLOW_ORIGINS = _parse_csv("API_CORS_ALLOW_ORIGINS", ["*"])
CORS_ALLOW_METHODS = _parse_csv("API_CORS_ALLOW_METHODS", ["GET", "POST", "OPTIONS"])
CORS_ALLOW_HEADERS = _parse_csv("API_CORS_ALLOW_HEADERS", ["Authorization", "Content-Type"])
CORS_MAX_AGE = int(os.environ.get("API_CORS_MAX_AGE", "600"))

SMTP_HOST = os.environ.get("SMTP_HOST", "")
SMTP_PORT = int(os.environ.get("SMTP_PORT", "587"))
SMTP_USER = os.environ.get("SMTP_USER", "")
SMTP_PASS = os.environ.get("SMTP_PASS", "")
SMTP_FROM = os.environ.get("SMTP_FROM", SMTP_USER or "no-reply@atropos-video.com")
SMTP_USE_TLS = os.environ.get("SMTP_USE_TLS", "true").lower() in ("1", "true", "yes")

WINDOW = int(os.environ.get("RATE_WINDOW_SECONDS", "60"))
MAX_REQ = int(os.environ.get("RATE_MAX_REQUESTS", "10"))

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def ensure_storage_files() -> None:
    """Make sure subscriber and token storage exists before use."""

    for path in (SUBSCRIBERS, UNSUB_TOKENS):
        path.parent.mkdir(parents=True, exist_ok=True)

    if not SUBSCRIBERS.exists():
        SUBSCRIBERS.write_text("[]", encoding="utf-8")
    if not UNSUB_TOKENS.exists():
        UNSUB_TOKENS.write_text("{}", encoding="utf-8")


ensure_storage_files()


__all__ = [
    "BASE_URL",
    "CORS_ALLOW_HEADERS",
    "CORS_ALLOW_METHODS",
    "CORS_ALLOW_ORIGINS",
    "CORS_MAX_AGE",
    "DATA_DIR",
    "EMAIL_RE",
    "MAX_REQ",
    "SMTP_FROM",
    "SMTP_HOST",
    "SMTP_PASS",
    "SMTP_PORT",
    "SMTP_USER",
    "SMTP_USE_TLS",
    "SUBSCRIBERS",
    "UNSUB_TOKENS",
    "WINDOW",
]
