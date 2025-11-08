from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, List


@dataclass(frozen=True)
class StorageSettings:
    data_dir: Path
    subscribers_file: Path
    unsub_tokens_file: Path
    base_url: str


@dataclass(frozen=True)
class CorsSettings:
    allow_origins: List[str]
    allow_methods: List[str]
    allow_headers: List[str]
    max_age: int


@dataclass(frozen=True)
class RateLimitSettings:
    window_seconds: int
    max_requests: int


@dataclass(frozen=True)
class SmtpSettings:
    host: str
    port: int
    username: str
    password: str
    sender: str
    use_tls: bool


@dataclass(frozen=True)
class ApiSettings:
    storage: StorageSettings
    cors: CorsSettings
    rate_limit: RateLimitSettings
    smtp: SmtpSettings


def _resolve_data_dir() -> Path:
    override = os.environ.get("DATA_DIR")
    if override:
        data_dir = Path(override)
    else:
        in_docker = os.environ.get("IN_DOCKER") == "1" or Path("/.dockerenv").exists()
        if in_docker:
            data_dir = Path("/data")
        else:
            data_dir = Path(__file__).resolve().parents[1] / "data"
    data_dir.mkdir(parents=True, exist_ok=True)
    return data_dir


def _parse_csv(name: str, default: Iterable[str]) -> List[str]:
    raw = os.environ.get(name)
    if raw is None:
        return list(default)
    values = [item.strip() for item in raw.split(",") if item.strip()]
    return values or list(default)


def load_settings() -> ApiSettings:
    data_dir = _resolve_data_dir()
    subscribers_file = Path(
        os.environ.get("SUBSCRIBERS_FILE", str(data_dir / "subscribers.json"))
    )
    unsub_tokens_file = Path(
        os.environ.get("UNSUB_TOKENS_FILE", str(data_dir / "unsub_tokens.json"))
    )

    storage = StorageSettings(
        data_dir=data_dir,
        subscribers_file=subscribers_file,
        unsub_tokens_file=unsub_tokens_file,
        base_url=os.environ.get("PUBLIC_BASE_URL", "https://atropos-video.com"),
    )

    cors = CorsSettings(
        allow_origins=_parse_csv("API_CORS_ALLOW_ORIGINS", ["*"]),
        allow_methods=_parse_csv("API_CORS_ALLOW_METHODS", ["GET", "POST", "OPTIONS"]),
        allow_headers=_parse_csv("API_CORS_ALLOW_HEADERS", ["Authorization", "Content-Type"]),
        max_age=int(os.environ.get("API_CORS_MAX_AGE", "600")),
    )

    smtp_username = os.environ.get("SMTP_USER", "")
    smtp = SmtpSettings(
        host=os.environ.get("SMTP_HOST", ""),
        port=int(os.environ.get("SMTP_PORT", "587")),
        username=smtp_username,
        password=os.environ.get("SMTP_PASS", ""),
        sender=os.environ.get("SMTP_FROM", smtp_username or "no-reply@atropos-video.com"),
        use_tls=os.environ.get("SMTP_USE_TLS", "true").lower() in ("1", "true", "yes"),
    )

    rate_limit = RateLimitSettings(
        window_seconds=int(os.environ.get("RATE_WINDOW_SECONDS", "60")),
        max_requests=int(os.environ.get("RATE_MAX_REQUESTS", "10")),
    )

    return ApiSettings(
        storage=storage,
        cors=cors,
        rate_limit=rate_limit,
        smtp=smtp,
    )
