"""Upload video(s) to all configured integrations.

This module authenticates with each platform and posts the provided video and
description. Platform defaults live in :mod:`server.config` and can be
overridden at runtime via the :func:`run` function.
"""

from __future__ import annotations

from dotenv import load_dotenv
load_dotenv(dotenv_path="../.env")

from importlib import import_module
from pathlib import Path
from typing import Callable, Dict
import os

from config import TIKTOK_CHUNK_SIZE, TIKTOK_PRIVACY_LEVEL, TOKENS_DIR, YOUTUBE_CATEGORY_ID, YOUTUBE_PRIVACY
import integrations.tiktok.upload as tt_upload

DEFAULT_VIDEO = Path("../out/Can_We_Spend_5_Gift_Cards_in_1_Hour__-_KF_AF_20190116/shorts/clip_1990.90-2080.90_r8.5_vertical.mp4")
DEFAULT_DESC = Path("../out/Can_We_Spend_5_Gift_Cards_in_1_Hour__-_KF_AF_20190116/shorts/clip_1990.90-2080.90_r8.5_description.txt")


def _ensure_tiktok_tokens(tokens_file: Path) -> None:
    """Ensure TikTok tokens exist by running the auth flow if needed."""
    if not tokens_file.exists():
        from integrations.tiktok import auth as tiktok_auth

        tiktok_auth.run()


def _upload_youtube(video: Path, desc: Path, privacy: str, category_id: str) -> None:
    from integrations.youtube import upload as yt_upload

    title, description = yt_upload.read_description(desc)
    response = yt_upload.upload_video(video, title, description, privacy, category_id)
    print("YouTube upload ID:", response.get("id"))


def _upload_instagram(video: Path, desc: Path) -> None:
    from integrations.instagram import upload as ig_upload

    caption = ig_upload._read_caption(desc)
    client = ig_upload.build_client()
    ig_upload.login_or_resume(client, ig_upload.USERNAME, ig_upload.PASSWORD)
    result = ig_upload.clip_upload_with_retries(client, video, caption)
    print("Instagram upload:", result)


def _upload_tiktok(
    video: Path,
    desc: Path,
    chunk_size: int,
    privacy_level: str,
    tokens_file: Path,
) -> None:
    _ensure_tiktok_tokens(tokens_file)
    caption = tt_upload.read_caption(desc)
    size = video.stat().st_size
    publish_id, upload_url = tt_upload.init_direct_post(
        size, chunk_size, caption, privacy_level
    )
    tt_upload.upload_video(upload_url, video, chunk_size)
    result = tt_upload.poll_status(publish_id)
    print("TikTok upload:", result)


def upload_all(
    video: Path,
    desc: Path,
    *,
    yt_privacy: str,
    yt_category_id: str,
    tt_chunk_size: int,
    tt_privacy: str,
    tokens_file: Path,
) -> None:
    """Upload the given video and description to all platforms."""

    uploaders: Dict[str, Callable[[], None]] = {
        "youtube": lambda: _upload_youtube(video, desc, yt_privacy, yt_category_id),
        "instagram": lambda: _upload_instagram(video, desc),
        "tiktok": lambda: _upload_tiktok(
            video, desc, tt_chunk_size, tt_privacy, tokens_file
        ),
    }

    for name, func in uploaders.items():
        print(f"== Uploading to {name} ==")
        try:
            func()
        except Exception as exc:  # pragma: no cover - defensive logging
            print(f"{name} upload failed: {exc}")


def run(
    video: Path | None = None,
    desc: Path | None = None,
    folder: Path | None = None,
    *,
    yt_privacy: str | None = None,
    yt_category_id: str | None = None,
    tt_chunk_size: int | None = None,
    tt_privacy: str | None = None,
    tokens_dir: Path | None = None,
) -> None:
    """Run uploads using configuration defaults with optional overrides.

    If ``folder`` is provided, all ``.mp4`` files inside it will be uploaded
    sequentially, each expecting a matching ``.txt`` description file.
    """

    tokens_dir = Path(tokens_dir) if tokens_dir else TOKENS_DIR
    tokens_dir.mkdir(parents=True, exist_ok=True)
    os.environ["YT_TOKENS_FILE"] = str(tokens_dir / "youtube.json")
    os.environ["TIKTOK_TOKENS_FILE"] = str(tokens_dir / "tiktok.json")
    tokens_file = Path(os.environ["TIKTOK_TOKENS_FILE"])

    yt_privacy = yt_privacy or YOUTUBE_PRIVACY
    yt_category_id = yt_category_id or YOUTUBE_CATEGORY_ID
    tt_chunk_size = tt_chunk_size or TIKTOK_CHUNK_SIZE
    tt_privacy = tt_privacy or TIKTOK_PRIVACY_LEVEL

    if folder:
        for vid in sorted(Path(folder).glob("*.mp4")):
            desc_path = vid.with_suffix(".txt")
            if not desc_path.exists():
                print(f"No description for {vid}, skipping")
                continue
            upload_all(
                vid,
                desc_path,
                yt_privacy=yt_privacy,
                yt_category_id=yt_category_id,
                tt_chunk_size=tt_chunk_size,
                tt_privacy=tt_privacy,
                tokens_file=tokens_file,
            )
    else:
        video = Path(video) if video else DEFAULT_VIDEO
        desc = Path(desc) if desc else DEFAULT_DESC
        upload_all(
            video,
            desc,
            yt_privacy=yt_privacy,
            yt_category_id=yt_category_id,
            tt_chunk_size=tt_chunk_size,
            tt_privacy=tt_privacy,
            tokens_file=tokens_file,
        )


def main() -> None:
    """Entry point for manual invocation.

    Modify the variables below to override configuration defaults.
    """

    video = DEFAULT_VIDEO
    desc = DEFAULT_DESC
    folder = None
    yt_privacy = YOUTUBE_PRIVACY
    yt_category_id = YOUTUBE_CATEGORY_ID
    tt_chunk_size = TIKTOK_CHUNK_SIZE
    tt_privacy = TIKTOK_PRIVACY_LEVEL
    tokens_dir = TOKENS_DIR

    run(
        video=video,
        desc=desc,
        folder=folder,
        yt_privacy=yt_privacy,
        yt_category_id=yt_category_id,
        tt_chunk_size=tt_chunk_size,
        tt_privacy=tt_privacy,
        tokens_dir=tokens_dir,
    )


if __name__ == "__main__":
    main()
