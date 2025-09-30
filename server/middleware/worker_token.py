"""Middleware for verifying Cloudflare Worker JWTs."""

from __future__ import annotations

import asyncio
import logging
import os
import threading
import time
from dataclasses import dataclass
from typing import Iterable
from urllib.parse import urljoin, urlparse, urlunparse

import requests
from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse
from starlette.status import HTTP_401_UNAUTHORIZED

from common.security import JwtVerificationError, load_ed25519_public_key, verify_ed25519_jwt
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey


logger = logging.getLogger(__name__)

_DEFAULT_LICENSE_BASE_URLS = {
    "dev": "https://dev.api.atropos-video.com",
    "prod": "https://api.atropos-video.com",
}

_LICENSE_BASE_ENV_KEYS = (
    "LICENSE_API_BASE_URL",
    "ATROPOS_LICENSE_API_BASE_URL",
    "VITE_LICENSE_API_BASE_URL",
    "ATROPOS_API_BASE_URL",
)

_ENVIRONMENT_KEYS = (
    "ATROPOS_ENV",
    "ENVIRONMENT",
    "NODE_ENV",
    "RELEASE_CHANNEL",
    "VITE_RELEASE_CHANNEL",
    "SERVER_ENV",
)

_DEVICE_HEADER = "x-atropos-device-hash"


def _normalise_base_url(value: str | None) -> str | None:
    if not value:
        return None
    candidate = value.strip()
    if not candidate:
        return None
    if not candidate.lower().startswith(("http://", "https://")):
        candidate = f"https://{candidate}"
    try:
        url = urlparse(candidate)
    except ValueError:
        return None
    if not url.scheme or not url.netloc:
        return None
    path = url.path.rstrip("/")
    return urlunparse((url.scheme, url.netloc, path, "", "", ""))


def _parse_environment(value: str | None) -> str:
    if not value:
        return "dev"
    token = value.strip().lower()
    if token in {"prod", "production", "release", "stable", "live"}:
        return "prod"
    return "dev"


def _resolve_license_base_url() -> str:
    for key in _LICENSE_BASE_ENV_KEYS:
        normalised = _normalise_base_url(os.getenv(key))
        if normalised:
            return normalised

    env_candidate = None
    for key in _ENVIRONMENT_KEYS:
        value = os.getenv(key)
        if value:
            env_candidate = value
            break

    environment = _parse_environment(env_candidate)
    return _DEFAULT_LICENSE_BASE_URLS.get(environment, _DEFAULT_LICENSE_BASE_URLS["dev"])


def _fetch_public_key_from_worker(url: str) -> dict | None:
    try:
        response = requests.get(url, timeout=5)
    except requests.RequestException as exc:  # pragma: no cover - network failure path
        logger.warning("Failed to fetch worker public key: %s", exc)
        return None

    if response.status_code != 200:
        logger.warning("Worker public key endpoint returned status %s", response.status_code)
        return None

    try:
        body = response.json()
    except ValueError:
        logger.warning("Worker public key endpoint returned invalid JSON")
        return None

    if not isinstance(body, dict):
        logger.warning("Worker public key response is not an object")
        return None

    return body


@dataclass(slots=True)
class _CachedKey:
    public_key: Ed25519PublicKey
    fetched_at: float


class WorkerTokenMiddleware(BaseHTTPMiddleware):
    """Validate Worker-signed JWTs on protected routes."""

    def __init__(
        self,
        app,
        *,
        protected_paths: Iterable[str] | None = None,
        env_var: str = "WORKER_JWT_PUBLIC_KEY",
        cache_ttl_seconds: int = 300,
    ) -> None:
        super().__init__(app)
        self._protected_paths = tuple(protected_paths or ("/api/jobs",))
        self._env_var = env_var
        self._cache_ttl = max(60, cache_ttl_seconds)
        self._lock = threading.Lock()
        self._public_key: _CachedKey | None = None

    async def _load_public_key(self) -> Ed25519PublicKey | None:
        raw = os.getenv(self._env_var, "").strip()
        if raw:
            try:
                return load_ed25519_public_key(raw)
            except ValueError:
                logger.warning("Invalid Ed25519 public key configured in %s", self._env_var)

        with self._lock:
            cached = self._public_key

        now = time.time()
        if cached and now - cached.fetched_at < self._cache_ttl:
            return cached.public_key

        base_url = _resolve_license_base_url()
        public_key_url = urljoin(f"{base_url}/", "license/public-key")

        loop = asyncio.get_running_loop()
        payload = await loop.run_in_executor(None, _fetch_public_key_from_worker, public_key_url)
        if not payload:
            return cached.public_key if cached else None

        try:
            public_key = load_ed25519_public_key(payload)
        except ValueError:
            logger.warning("Worker public key payload is not a valid Ed25519 JWK")
            return cached.public_key if cached else None

        with self._lock:
            self._public_key = _CachedKey(public_key=public_key, fetched_at=now)

        return public_key

    @staticmethod
    def _extract_token(request: Request) -> str | None:
        header = request.headers.get("authorization")
        if header:
            scheme, _, rest = header.partition(" ")
            if scheme.lower() == "bearer":
                token = rest.strip()
                if token:
                    return token
        token = request.query_params.get("token")
        if token:
            token = token.strip()
            if token:
                return token
        return None

    def _is_protected(self, path: str) -> bool:
        return any(path.startswith(prefix) for prefix in self._protected_paths)

    @staticmethod
    def _is_token_active(payload: dict) -> bool:
        exp = payload.get("exp")
        if not isinstance(exp, (int, float)):
            return False
        return exp > time.time()

    def _extract_device_hash(self, request: Request) -> str | None:
        header_value = request.headers.get(_DEVICE_HEADER)
        if header_value and header_value.strip():
            return header_value.strip()
        query_value = request.query_params.get("device_hash")
        if query_value and query_value.strip():
            return query_value.strip()
        return None

    async def dispatch(self, request: Request, call_next):  # type: ignore[override]
        path = request.url.path
        if not self._is_protected(path) or request.method.upper() == "OPTIONS":
            return await call_next(request)

        public_key = await self._load_public_key()
        if public_key is None:
            return JSONResponse(
                {"detail": "Worker token verification is not configured"},
                status_code=HTTP_401_UNAUTHORIZED,
            )

        token = self._extract_token(request)
        if not token:
            return JSONResponse(
                {"detail": "Missing worker token"},
                status_code=HTTP_401_UNAUTHORIZED,
            )

        try:
            segments = verify_ed25519_jwt(token, public_key)
        except JwtVerificationError:
            return JSONResponse(
                {"detail": "Invalid worker token"},
                status_code=HTTP_401_UNAUTHORIZED,
            )

        if not self._is_token_active(segments.payload):
            return JSONResponse(
                {"detail": "Expired worker token"},
                status_code=HTTP_401_UNAUTHORIZED,
            )

        claim_device_hash = segments.payload.get("device_hash")
        if not isinstance(claim_device_hash, str) or not claim_device_hash:
            return JSONResponse(
                {"detail": "Worker token is missing device binding"},
                status_code=HTTP_401_UNAUTHORIZED,
            )

        request_device_hash = self._extract_device_hash(request)
        if request_device_hash is None:
            return JSONResponse(
                {"detail": "Device hash header is required"},
                status_code=HTTP_401_UNAUTHORIZED,
            )

        if request_device_hash != claim_device_hash:
            return JSONResponse(
                {"detail": "Device hash does not match the active license"},
                status_code=HTTP_401_UNAUTHORIZED,
            )

        request.state.worker_claims = segments.payload
        request.state.worker_device_hash = claim_device_hash
        return await call_next(request)


__all__ = ["WorkerTokenMiddleware"]
