from dataclasses import dataclass
from typing import Optional

from helpers.logging import run_step
from .steps.instagram import upload_instagram
from .steps.tiktok import upload_tiktok
from .steps.youtube import upload_youtube
from .steps.facebook import upload_facebook
from .steps.snapchat import upload_snapchat
from .steps.twitter import upload_twitter


@dataclass
class UploadConfig:
    """Configuration for upload targets."""

    instagram_account: str
    tiktok_account: str
    youtube_account: str
    facebook_page: str
    snapchat_account: str
    twitter_account: str
    instagram_token: Optional[str] = None
    tiktok_token: Optional[str] = None
    youtube_token: Optional[str] = None
    facebook_token: Optional[str] = None
    snapchat_token: Optional[str] = None
    twitter_token: Optional[str] = None


def upload_video_to_all(
    video_path: str,
    caption: str,
    title: str,
    description: str,
    config: UploadConfig,
) -> None:
    """Upload ``video_path`` to all configured platforms.

    Each step is wrapped in ``run_step`` for consistent logging.
    """

    run_step(
        "Upload to Instagram",
        upload_instagram,
        video_path,
        caption,
        config.instagram_account,
        config.instagram_token,
    )
    run_step(
        "Upload to TikTok",
        upload_tiktok,
        video_path,
        caption,
        config.tiktok_account,
        config.tiktok_token,
    )
    run_step(
        "Upload to YouTube",
        upload_youtube,
        video_path,
        title,
        description,
        config.youtube_account,
        config.youtube_token,
    )
    run_step(
        "Upload to Facebook",
        upload_facebook,
        video_path,
        caption,
        config.facebook_page,
        config.facebook_token,
    )
    run_step(
        "Upload to Snapchat",
        upload_snapchat,
        video_path,
        caption,
        config.snapchat_account,
        config.snapchat_token,
    )
    run_step(
        "Upload to Twitter",
        upload_twitter,
        video_path,
        caption,
        config.twitter_account,
        config.twitter_token,
    )
