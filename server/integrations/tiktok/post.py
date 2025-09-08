"""Facade for posting videos to TikTok via multiple backends."""

from __future__ import annotations

from pathlib import Path
from typing import Optional, Dict, Any

from config import (
    TIKTOK_CHUNK_SIZE,
    TIKTOK_PRIVACY_LEVEL,
    TIKTOK_UPLOAD_BACKEND,
)
from . import upload as api_upload
from integrations.tiktok_autouploader.uploader import (
    upload_video_with_autouploader,
)


def _post_via_api(
    video_path: str, caption: str, cover_timestamp_ms: Optional[int]
) -> Dict[str, Any]:  # pragma: no cover - exercised via facade tests
    """Upload using the official TikTok API."""

    path = Path(video_path)
    size = path.stat().st_size
    publish_id, upload_url = api_upload.init_direct_post(
        size, TIKTOK_CHUNK_SIZE, caption, TIKTOK_PRIVACY_LEVEL
    )
    api_upload.upload_video(upload_url, path, TIKTOK_CHUNK_SIZE)
    data = api_upload.poll_status(publish_id)
    status = data.get("status", "")
    result_status = "posted" if status == "PUBLISH_COMPLETE" else status.lower()
    return {"status": result_status, "post_url": None, "debug": data}


def post_to_tiktok(
    video_path: str, caption: str, cover_timestamp_ms: Optional[int] = None
) -> Dict[str, Any]:
    """Post ``video_path`` with ``caption`` to TikTok.

    The backend is selected via :data:`TIKTOK_UPLOAD_BACKEND`. The function
    prints the backend used for observability.
    """

    print(f"TikTok backend = {TIKTOK_UPLOAD_BACKEND}")
    if TIKTOK_UPLOAD_BACKEND == "api":
        return _post_via_api(video_path, caption, cover_timestamp_ms)
    return upload_video_with_autouploader(video_path, caption, cover_timestamp_ms)
