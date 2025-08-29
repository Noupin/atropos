"""Encrypted token storage using Fernet."""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, Dict

from cryptography.fernet import Fernet


class TokenStore:
    """Persist tokens for multiple services in a single encrypted file."""

    def __init__(self, path: Path | str) -> None:
        self.path = Path(path)
        key = os.environ.get("TOKEN_FERNET_KEY")
        if not key:
            raise RuntimeError("TOKEN_FERNET_KEY missing from environment")
        self.fernet = Fernet(key.encode())

    # ------------------------------------------------------------------
    def _read_all(self) -> Dict[str, Any]:
        if not self.path.exists():
            return {}
        raw = self.path.read_bytes()
        try:
            data = self.fernet.decrypt(raw)
        except Exception:
            return {}
        try:
            return json.loads(data.decode("utf-8"))
        except Exception:
            return {}

    # ------------------------------------------------------------------
    def load(self, name: str) -> Dict[str, Any] | None:
        """Load a token by ``name`` or return ``None``."""

        return self._read_all().get(name)

    # ------------------------------------------------------------------
    def save(self, name: str, token: Dict[str, Any]) -> None:
        """Store ``token`` under ``name``."""

        data = self._read_all()
        data[name] = token
        self.path.parent.mkdir(parents=True, exist_ok=True)
        raw = json.dumps(data).encode("utf-8")
        self.path.write_bytes(self.fernet.encrypt(raw))


__all__ = ["TokenStore"]

