"""Upload implementation for Instagram Reels using the Graph API."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any, Dict

import requests


def upload_video(token: Dict[str, Any], video: Path, caption: str) -> str:
    """Upload ``video`` with ``caption`` and return the resulting media id."""

    ig_id = os.environ["IG_BUSINESS_ID"]
    params = {
        "caption": caption,
        "media_type": "REELS",
        "access_token": token["access_token"],
    }
    files = {"video_file": open(video, "rb")}
    resp = requests.post(
        f"https://graph.facebook.com/v18.0/{ig_id}/media",
        params=params,
        files=files,
        timeout=600,
    )
    resp.raise_for_status()
    creation_id = resp.json()["id"]

    resp = requests.post(
        f"https://graph.facebook.com/v18.0/{ig_id}/media_publish",
        params={
            "creation_id": creation_id,
            "access_token": token["access_token"],
        },
        timeout=60,
    )
    resp.raise_for_status()
    return resp.json().get("id", creation_id)


__all__ = ["upload_video"]


