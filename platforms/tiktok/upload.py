"""Upload helper for TikTok's Content Posting API."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict

import requests


def upload_video(token: Dict[str, Any], video: Path, caption: str) -> str:
    """Upload ``video`` and return the resulting job or post id."""

    headers = {
        "Authorization": f"Bearer {token['access_token']}",
        "Content-Type": "application/json",
    }
    resp = requests.post(
        "https://open.tiktokapis.com/v2/post/publish/inbox/video/init/",
        headers=headers,
        json={"source_info": {"source": "FILE"}},
        timeout=60,
    )
    resp.raise_for_status()
    data = resp.json()["data"]
    upload_url = data["upload_url"]
    video_id = data["video_id"]

    with open(video, "rb") as fh:
        upload_resp = requests.put(upload_url, data=fh.read(), timeout=600)
    upload_resp.raise_for_status()

    resp = requests.post(
        "https://open.tiktokapis.com/v2/post/publish/inbox/video/create/",
        headers=headers,
        json={"video_id": video_id, "text": caption},
        timeout=60,
    )
    resp.raise_for_status()
    return resp.json()["data"].get("post_id", video_id)


__all__ = ["upload_video"]


