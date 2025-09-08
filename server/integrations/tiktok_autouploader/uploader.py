"""Video uploader using the `tiktokautouploader` package."""

from __future__ import annotations

import time
from typing import Optional, Dict, Any

from config import (
    TIKTOK_AUTO_BROWSER,
    TIKTOK_AUTO_HEADLESS,
    TIKTOK_AUTO_MAX_RETRIES,
    TIKTOK_AUTO_PROXY,
    TIKTOK_AUTO_RETRY_BACKOFF_SEC,
    TIKTOK_AUTO_TIMEOUT_SEC,
    TIKTOK_AUTO_UPLOAD_URL,
)
from helpers.logging import log_timing

from . import auth


class UploadError(Exception):
    """Error raised when the autouploader fails."""

    def __init__(self, code: str, details: Any | None = None) -> None:
        super().__init__(code)
        self.code = code
        self.details = details


def _build_client():  # pragma: no cover - depends on external library
    from tiktokautouploader import TikTokUploader

    return TikTokUploader(
        headless=TIKTOK_AUTO_HEADLESS,
        browser=TIKTOK_AUTO_BROWSER,
        proxy=TIKTOK_AUTO_PROXY or None,
        upload_url=TIKTOK_AUTO_UPLOAD_URL or None,
        timeout=TIKTOK_AUTO_TIMEOUT_SEC,
    )


def upload_video_with_autouploader(
    video_path: str, caption: str, cover_timestamp_ms: Optional[int]
) -> Dict[str, Any]:
    """Upload ``video_path`` with ``caption`` via browser automation."""

    last_error: UploadError | None = None
    for attempt in range(1, TIKTOK_AUTO_MAX_RETRIES + 2):
        try:
            with log_timing(f"[TikTok][Auto] attempt {attempt}"):
                client = _build_client()
                auth.ensure_cookies(client)
                print("[TikTok][Auto] Launching browser…")
                client.open_upload()
                print("[TikTok][Auto] Cookies found: yes")
                client.select_video(video_path)
                print("[TikTok][Auto] File selected")
                client.set_caption(caption)
                print("[TikTok][Auto] Caption applied")
                if cover_timestamp_ms is not None:
                    client.set_cover(cover_timestamp_ms)
                client.publish()
                print("[TikTok][Auto] Publish clicked")
                url = client.wait_for_post_url()
                print(f"[TikTok][Auto] Success URL: {url}")
                return {"status": "posted", "post_url": url, "debug": {"attempt": attempt}}
        except UploadError as exc:
            last_error = exc
        except Exception as exc:  # pragma: no cover - defensive
            last_error = UploadError("exception", str(exc))
        if attempt <= TIKTOK_AUTO_MAX_RETRIES:
            backoff = TIKTOK_AUTO_RETRY_BACKOFF_SEC * (2 ** (attempt - 1))
            print(f"[TikTok][Auto] retrying in {backoff}s…")
            time.sleep(backoff)
    raise last_error or UploadError("unknown")
