"""Authentication helpers for the TikTok browser uploader."""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, List

from config import TIKTOK_AUTO_COOKIES_PATH


def _read_cookies(path: Path) -> List[dict[str, Any]] | None:
    """Return cookies from ``path`` if it exists."""
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:  # pragma: no cover - fallback when file missing
        return None


def _write_cookies(path: Path, cookies: List[dict[str, Any]]) -> None:
    """Persist ``cookies`` atomically with restrictive permissions."""
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(cookies), encoding="utf-8")
    os.replace(tmp, path)
    path.chmod(0o600)


def ensure_cookies(uploader: Any) -> List[dict[str, Any]]:
    """Load cookies for ``uploader`` or guide the user through login.

    The function tries to reuse persisted cookies. When they are missing or
    rejected by TikTok, a headful browser window is opened to let the user log
    in manually. Cookies from the successful session are then stored at
    :data:`TIKTOK_AUTO_COOKIES_PATH` for reuse on subsequent runs.
    """

    path = Path(TIKTOK_AUTO_COOKIES_PATH)
    cookies = _read_cookies(path)
    if cookies:
        try:
            uploader.set_cookies(cookies)
            return cookies
        except Exception:  # pragma: no cover - library handles validation
            pass

    print(
        "Please complete TikTok login in the opened window. Close the window or "
        "press Enter here when you see your profile avatar."
    )
    uploader.launch_login()
    input()
    cookies = uploader.get_cookies()
    _write_cookies(path, cookies)
    return cookies
