"""Upload helper for Snapchat Public Profiles."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any, Dict

import requests


def upload_video(token: Dict[str, Any], video: Path, caption: str) -> str:
    """Upload ``video`` and return the resulting post id."""

    profile_id = os.environ["SNAPCHAT_PROFILE_ID"]
    headers = {"Authorization": f"Bearer {token['access_token']}"}
    files = {
        "media": (video.name, open(video, "rb"), "video/mp4"),
        "type": (None, "VIDEO"),
    }
    resp = requests.post(
        "https://adsapi.snapchat.com/v1/media",
        headers=headers,
        files=files,
        timeout=600,
    )
    resp.raise_for_status()
    media_id = resp.json()["data"]["id"]

    resp = requests.post(
        "https://adsapi.snapchat.com/v1/organic/posts",
        headers=headers,
        json={"profile_id": profile_id, "media_id": media_id, "caption": caption},
        timeout=60,
    )
    resp.raise_for_status()
    return resp.json()["data"].get("id", media_id)


__all__ = ["upload_video"]


