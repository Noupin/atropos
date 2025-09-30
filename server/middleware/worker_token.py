"""Middleware for verifying Cloudflare Worker JWTs."""

from __future__ import annotations

import os
import threading
import time
from typing import Iterable

from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse
from starlette.status import HTTP_401_UNAUTHORIZED

from common.security import JwtVerificationError, load_ed25519_public_key, verify_ed25519_jwt
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey


class WorkerTokenMiddleware(BaseHTTPMiddleware):
    """Validate Worker-signed JWTs on protected routes."""

    def __init__(
        self,
        app,
        *,
        protected_paths: Iterable[str] | None = None,
        env_var: str = "WORKER_JWT_PUBLIC_KEY",
    ) -> None:
        super().__init__(app)
        self._protected_paths = tuple(protected_paths or ("/api/jobs",))
        self._env_var = env_var
        self._lock = threading.Lock()
        self._public_key: Ed25519PublicKey | None = None
        self._cached_raw: str | None = None

    def _load_public_key(self) -> Ed25519PublicKey | None:
        raw = os.getenv(self._env_var, "").strip()
        if not raw:
            return None

        with self._lock:
            if self._public_key is not None and raw == self._cached_raw:
                return self._public_key
            try:
                public_key = load_ed25519_public_key(raw)
            except ValueError:
                return None
            self._public_key = public_key
            self._cached_raw = raw
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

    async def dispatch(self, request: Request, call_next):  # type: ignore[override]
        path = request.url.path
        if not self._is_protected(path) or request.method.upper() == "OPTIONS":
            return await call_next(request)

        public_key = self._load_public_key()
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

        request.state.worker_claims = segments.payload
        return await call_next(request)


__all__ = ["WorkerTokenMiddleware"]
