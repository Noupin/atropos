"""Helpers for resolving output directories for account pipelines."""

from pathlib import Path
from typing import Optional

GENERAL_ACCOUNT_DIRECTORY = "general"


def resolve_account_output_dir(base: Path, account_id: Optional[str]) -> Path:
    """Return the directory for ``account_id`` under ``base``.

    The general workspace lives in ``base/general``. Account-specific
    directories are namespaced by their identifier.
    """

    if account_id:
        return base / account_id
    return base / GENERAL_ACCOUNT_DIRECTORY


def ensure_account_output_dir(base: Path, account_id: Optional[str]) -> Path:
    """Resolve and create the directory for ``account_id`` under ``base``."""

    target = resolve_account_output_dir(base, account_id)
    target.mkdir(parents=True, exist_ok=True)
    return target


__all__ = [
    "GENERAL_ACCOUNT_DIRECTORY",
    "ensure_account_output_dir",
    "resolve_account_output_dir",
]
