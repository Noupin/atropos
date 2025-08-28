from server.upload.pipeline import UploadConfig, upload_video_to_all
from unittest.mock import patch


def test_upload_video_to_all_passes_tokens():
    config = UploadConfig(
        instagram_account="insta",
        instagram_token="insta_token",
        tiktok_account="tiktok",
        tiktok_token="tiktok_token",
        youtube_account="youtube",
        youtube_token="youtube_token",
        facebook_page="facebook",
        facebook_token="facebook_token",
        snapchat_account="snap",
        snapchat_token="snap_token",
        twitter_account="twitter",
        twitter_token="twitter_token",
    )
    with (
        patch("server.upload.pipeline.upload_instagram") as m_inst,
        patch("server.upload.pipeline.upload_tiktok") as m_tiktok,
        patch("server.upload.pipeline.upload_youtube") as m_yt,
        patch("server.upload.pipeline.upload_facebook") as m_fb,
        patch("server.upload.pipeline.upload_snapchat") as m_snap,
        patch("server.upload.pipeline.upload_twitter") as m_tw,
    ):
        upload_video_to_all("video.mp4", "cap", "title", "desc", config)
        m_inst.assert_called_once_with("video.mp4", "cap", "insta", "insta_token")
        m_tiktok.assert_called_once_with("video.mp4", "cap", "tiktok", "tiktok_token")
        m_yt.assert_called_once_with("video.mp4", "title", "desc", "youtube", "youtube_token")
        m_fb.assert_called_once_with("video.mp4", "cap", "facebook", "facebook_token")
        m_snap.assert_called_once_with("video.mp4", "cap", "snap", "snap_token")
        m_tw.assert_called_once_with("video.mp4", "cap", "twitter", "twitter_token")
