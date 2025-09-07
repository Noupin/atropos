from unittest.mock import MagicMock, patch

import yt_dlp

from server.steps.download import get_video_info, get_video_urls


def test_get_video_urls_private_video():
    """Private videos should trigger an email and be skipped."""
    ydl = MagicMock()
    ydl.__enter__.return_value = ydl
    ydl.extract_info.side_effect = yt_dlp.utils.DownloadError("Private video")
    with patch("server.steps.download.yt_dlp.YoutubeDL", return_value=ydl), patch(
        "server.steps.download.send_failure_email"
    ) as email:
        urls = get_video_urls("https://www.youtube.com/watch?v=abc")
    assert urls == []
    email.assert_called_once()


def test_get_video_info_private_video():
    """Private videos should trigger an email and return None."""
    ydl = MagicMock()
    ydl.__enter__.return_value = ydl
    ydl.extract_info.side_effect = yt_dlp.utils.DownloadError("Private video")
    with patch("server.steps.download.yt_dlp.YoutubeDL", return_value=ydl), patch(
        "server.steps.download.send_failure_email"
    ) as email:
        info = get_video_info("https://www.youtube.com/watch?v=abc")
    assert info is None
    email.assert_called_once()

