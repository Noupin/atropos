"""Upload helper for Facebook Pages using the Graph API."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any, Dict

import requests


def upload_video(token: Dict[str, Any], video: Path, caption: str) -> str:
    """Upload ``video`` and return the Facebook ``video_id``."""

    page_id = os.environ["FACEBOOK_PAGE_ID"]
    data = {
        "description": caption,
        "title": caption[:70],
        "access_token": token["access_token"],
    }
    files = {"source": open(video, "rb")}
    resp = requests.post(
        f"https://graph-video.facebook.com/v18.0/{page_id}/videos",
        data=data,
        files=files,
        timeout=600,
    )
    resp.raise_for_status()
    return resp.json()["id"]


__all__ = ["upload_video"]


