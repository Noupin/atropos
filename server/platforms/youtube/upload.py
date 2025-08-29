"""Upload helper for the YouTube Data API."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict

import requests


def upload_video(token: Dict[str, Any], video: Path, caption: str) -> str:
    """Upload ``video`` and return the resulting YouTube ``videoId``."""

    headers = {"Authorization": f"Bearer {token['access_token']}"}
    metadata = {
        "snippet": {"title": caption[:70], "description": caption},
        "status": {"privacyStatus": "unlisted"},
    }
    files = {
        "snippet": (None, json.dumps(metadata["snippet"]), "application/json"),
        "status": (None, json.dumps(metadata["status"]), "application/json"),
        "video": (video.name, open(video, "rb"), "video/*"),
    }
    resp = requests.post(
        "https://www.googleapis.com/upload/youtube/v3/videos"
        "?part=snippet,status&uploadType=multipart",
        headers=headers,
        files=files,
        timeout=600,
    )
    resp.raise_for_status()
    return resp.json()["id"]


__all__ = ["upload_video"]


