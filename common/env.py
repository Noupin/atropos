"""Simple .env loader used across the project."""

from __future__ import annotations

import os
from pathlib import Path


def load_env(path: Path | str = Path(".env")) -> None:
    """Load environment variables from ``path`` if it exists.

    The loader is intentionally tiny to avoid external dependencies such as
    :mod:`python-dotenv`. Variables already present in ``os.environ`` are not
    overwritten.
    """

    env_path = Path(path)
    if not env_path.exists():
        return

    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        key, sep, value = line.partition("=")
        if sep:
            os.environ.setdefault(key.strip(), value.strip())


__all__ = ["load_env"]

