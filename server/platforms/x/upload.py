"""Upload helper for X (Twitter) using the v1.1 media endpoints."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any, Dict

import requests
from requests_oauthlib import OAuth1


def upload_video(token: Dict[str, Any], video: Path, caption: str) -> str:
    """Upload ``video`` and return the resulting Tweet id."""

    oauth = OAuth1(
        os.environ["X_CONSUMER_KEY"],
        os.environ["X_CONSUMER_SECRET"],
        token["oauth_token"],
        token["oauth_token_secret"],
    )

    init = requests.post(
        "https://upload.twitter.com/1.1/media/upload.json",
        data={
            "command": "INIT",
            "total_bytes": video.stat().st_size,
            "media_type": "video/mp4",
        },
        auth=oauth,
        timeout=60,
    )
    init.raise_for_status()
    media_id = init.json()["media_id_string"]

    with open(video, "rb") as fh:
        segment = 0
        while True:
            chunk = fh.read(5 * 1024 * 1024)
            if not chunk:
                break
            requests.post(
                "https://upload.twitter.com/1.1/media/upload.json",
                data={
                    "command": "APPEND",
                    "media_id": media_id,
                    "segment_index": segment,
                },
                files={"media": chunk},
                auth=oauth,
                timeout=60,
            ).raise_for_status()
            segment += 1

    finalize = requests.post(
        "https://upload.twitter.com/1.1/media/upload.json",
        data={"command": "FINALIZE", "media_id": media_id},
        auth=oauth,
        timeout=60,
    )
    finalize.raise_for_status()

    tweet = requests.post(
        "https://api.twitter.com/2/tweets",
        json={"text": caption, "media": {"media_ids": [media_id]}},
        auth=oauth,
        timeout=60,
    )
    tweet.raise_for_status()
    return tweet.json()["data"]["id"]


__all__ = ["upload_video"]


