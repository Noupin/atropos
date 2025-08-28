from __future__ import annotations

import json
from pathlib import Path
from typing import Iterable

from .pipeline import UploadConfig, upload_video_to_all


def upload_folder(
    folder_path: str,
    config: UploadConfig,
    extensions: Iterable[str] = (".mp4", ".mov"),
) -> None:
    """Upload all videos in ``folder_path`` to all configured accounts.

    Each video file must have an accompanying ``.json`` file with the same
    name containing ``title``, ``description`` and optional ``hashtags`` (list
    of strings). Hashtags are appended to both the caption and the description
    when uploading.
    """
    folder = Path(folder_path)
    for ext in extensions:
        for video_path in folder.glob(f"*{ext}"):
            metadata_path = video_path.with_suffix(".json")
            if not metadata_path.exists():
                continue
            with metadata_path.open("r", encoding="utf-8") as f:
                metadata = json.load(f)
            title = metadata.get("title", video_path.stem)
            description = metadata.get("description", "")
            hashtags = metadata.get("hashtags", [])
            hashtags_str = " ".join(hashtags).strip()
            caption_parts = [description.strip()]
            if hashtags_str:
                caption_parts.append(hashtags_str)
            caption = " ".join(part for part in caption_parts if part)
            if hashtags_str:
                description_full = f"{description}\n\n{hashtags_str}".strip()
            else:
                description_full = description
            upload_video_to_all(
                str(video_path),
                caption,
                title,
                description_full,
                config,
            )
