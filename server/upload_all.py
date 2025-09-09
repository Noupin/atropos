"""Upload video(s) to all configured integrations.
This module authenticates with each platform and posts the provided video and
description. Platform defaults live in :mod:`server.config` and can be
overridden at runtime via the :func:`run` function.
"""

from __future__ import annotations

import json
import os
from datetime import datetime
from pathlib import Path
from typing import Callable, Dict, Sequence

from dotenv import load_dotenv
load_dotenv(dotenv_path="../.env")

from config import (
    TIKTOK_CHUNK_SIZE,
    TIKTOK_PRIVACY_LEVEL,
    TOKENS_DIR,
    YOUTUBE_CATEGORY_ID,
    YOUTUBE_PRIVACY,
)
from helpers.notifications import send_failure_email

from integrations.tiktok import upload as tt_upload
from integrations.youtube.auth import ensure_creds, refresh_creds
from integrations.tiktok.auth import (
    run as run_tiktok_auth,
    refresh_tokens as refresh_tiktok_tokens,
)
from integrations.instagram.upload import (
    login_or_resume,
    build_client,
)

DEFAULT_VIDEO = Path(
    "../out/funny/We_Celebrate_Shower_With_A_Friend_Day_-_KF_AF_20190206/shorts/clip_3255.02-3268.96_r9.0.mp4"
)
DEFAULT_DESC = Path(
    "../out/funny/We_Celebrate_Shower_With_A_Friend_Day_-_KF_AF_20190206/shorts/clip_3255.02-3268.96_r9.0.txt"
)


def _failure_details(platform: str, video: Path, account: str | None, error: str) -> str:
    """Return a formatted failure message with contextual information."""
    timestamp = datetime.utcnow().isoformat()
    return (
        f"Account: {account or 'unknown'}\n"
        f"Video: {video}\n"
        f"Platform: {platform}\n"
        f"Time: {timestamp}\n"
        f"Error: {error}"
    )


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


def _upload_instagram(video: Path, desc: Path, username: str, password: str) -> None:
    from integrations.instagram import upload as ig_upload

    caption = ig_upload._read_caption(desc)
    client = ig_upload.build_client()
    ig_upload.login_or_resume(client, username, password)
    result = ig_upload.clip_upload_with_retries(
        client, video, caption, username, password
    )
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


def _read_instagram_creds(path: Path) -> tuple[str, str]:
    """Return Instagram username and password from ``path``."""
    data = json.loads(path.read_text())
    return data["username"], data["password"]


def _get_auth_refreshers(
    username: str, password: str, video: Path, account: str | None
) -> Dict[str, Callable[[], None]]:
    """Return callables to refresh auth for each platform."""

    def yt_refresh() -> None:
        if refresh_creds():
            return
        body = _failure_details(
            "youtube",
            video,
            account,
            "Automatic refresh failed for YouTube. A full re-auth was attempted.",
        )
        send_failure_email("YouTube authentication required", body)
        ensure_creds()

    def tt_refresh() -> None:
        if refresh_tiktok_tokens():
            return
        body = _failure_details(
            "tiktok",
            video,
            account,
            "Automatic refresh failed for TikTok. A full re-auth was attempted.",
        )
        send_failure_email("TikTok authentication required", body)
        run_tiktok_auth()

    return {
        "youtube": yt_refresh,
        "instagram": lambda: login_or_resume(
            build_client(), username, password
        ),
        "tiktok": tt_refresh,
    }


def _tidy_empty_dirs(shorts: Path, project: Path) -> None:
    """Delete empty ``shorts`` and project directories."""

    if not any(shorts.iterdir()):
        shorts.rmdir()
        if not any(project.iterdir()):
            project.rmdir()


def upload_all(
    video: Path,
    desc: Path,
    *,
    yt_privacy: str,
    yt_category_id: str,
    tt_chunk_size: int,
    tt_privacy: str,
    tokens_file: Path,
    ig_username: str,
    ig_password: str,
    account: str | None = None,
    platforms: Sequence[str] | None = None,
) -> None:
    """Upload the given video and description to selected platforms.

    Parameters
    ----------
    video:
        Video file path to upload.
    desc:
        Path to the accompanying description text file.
    yt_privacy, yt_category_id, tt_chunk_size, tt_privacy, tokens_file,
    ig_username, ig_password:
        See :func:`run` for details.
    platforms:
        Optional iterable of platform names to upload to. If ``None`` or empty,
        all supported platforms are used. Valid names are ``"youtube"``,
        ``"instagram"`` and ``"tiktok"``.
    """

    uploaders: Dict[str, Callable[[], None]] = {
        "youtube": lambda: _upload_youtube(video, desc, yt_privacy, yt_category_id),
        "instagram": lambda: _upload_instagram(
            video, desc, ig_username, ig_password
        ),
        "tiktok": lambda: _upload_tiktok(
            video, desc, tt_chunk_size, tt_privacy, tokens_file
        ),
    }
    if platforms:
        allowed = {name for name in platforms}
        uploaders = {n: f for n, f in uploaders.items() if n in allowed}
    auth_refreshers = _get_auth_refreshers(ig_username, ig_password, video, account)

    for name, func in uploaders.items():
        print(f"== Uploading to {name} ==")
        try:
            func()
        except Exception as exc:  # pragma: no cover - defensive logging
            print(f"{name} upload failed: {exc}")
            refresher = auth_refreshers.get(name)
            if refresher:
                try:
                    refresher()
                    func()
                    continue
                except Exception as exc2:  # pragma: no cover - defensive logging
                    print(f"{name} retry failed: {exc2}")
                    body = _failure_details(
                        name,
                        video,
                        account,
                        f"{name} retry after re-authentication failed: {exc2}",
                    )
                    send_failure_email(f"{name} upload failed", body)
                    continue
            body = _failure_details(name, video, account, str(exc))
            send_failure_email(f"{name} upload failed", body)


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
    account: str | None = None,
    platforms: Sequence[str] | None = None,
) -> None:
    """Run uploads using configuration defaults with optional overrides.

    Parameters
    ----------
    video, desc, folder, yt_privacy, yt_category_id, tt_chunk_size,
    tt_privacy, tokens_dir:
        See :func:`upload_all` for descriptions.
    account:
        Optional account name used to namespace token files under
        ``tokens/<account>``.
    platforms:
        Optional iterable restricting which platforms to upload to.

    If ``folder`` is provided, all ``.mp4`` files inside it will be uploaded
    sequentially, each expecting a matching ``.txt`` description file. When
    omitted, ``video`` and ``desc`` specify a single upload.
    """

    tokens_dir = Path(tokens_dir) if tokens_dir else TOKENS_DIR
    if account:
        tokens_dir = tokens_dir / account
    tokens_dir.mkdir(parents=True, exist_ok=True)
    os.environ["YT_TOKENS_FILE"] = str(tokens_dir / "youtube.json")
    os.environ["TIKTOK_TOKENS_FILE"] = str(tokens_dir / "tiktok.json")
    tokens_file = Path(os.environ["TIKTOK_TOKENS_FILE"])
    ig_creds_file = tokens_dir / "instagram.json"
    ig_username, ig_password = _read_instagram_creds(ig_creds_file)

    yt_privacy = yt_privacy or YOUTUBE_PRIVACY
    yt_category_id = yt_category_id or YOUTUBE_CATEGORY_ID
    tt_chunk_size = tt_chunk_size or TIKTOK_CHUNK_SIZE
    tt_privacy = tt_privacy or TIKTOK_PRIVACY_LEVEL

    if folder:
        folder = Path(folder)
        for vid in sorted(folder.glob("*.mp4")):
            desc_path = vid.with_suffix(".txt")
            if not desc_path.exists():
                print(f"No description for {vid}, skipping")
                continue
            try:
                upload_all(
                    vid,
                    desc_path,
                    yt_privacy=yt_privacy,
                    yt_category_id=yt_category_id,
                    tt_chunk_size=tt_chunk_size,
                    tt_privacy=tt_privacy,
                    tokens_file=tokens_file,
                    ig_username=ig_username,
                    ig_password=ig_password,
                    account=account,
                    platforms=platforms,
                )
            finally:
                for f in vid.parent.glob(f"{vid.stem}.*"):
                    if f.is_file():
                        f.unlink(missing_ok=True)
        if folder.exists():
            _tidy_empty_dirs(folder, folder.parent)
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
            ig_username=ig_username,
            ig_password=ig_password,
            account=account,
            platforms=platforms,
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
    account = None

    run(
        video=video,
        desc=desc,
        folder=folder,
        yt_privacy=yt_privacy,
        yt_category_id=yt_category_id,
        tt_chunk_size=tt_chunk_size,
        tt_privacy=tt_privacy,
        tokens_dir=tokens_dir,
        account=account,
    )


if __name__ == "__main__":
    main()
