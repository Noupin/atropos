import yt_dlp
from unittest.mock import MagicMock, patch

from server.steps.download import get_video_urls


def test_get_video_urls_playlist():
    ydl = MagicMock()
    ydl.__enter__.return_value = ydl
    ydl.extract_info.return_value = {
        "entries": [{"id": "abc"}, {"id": "def"}]
    }
    with patch("server.steps.download.yt_dlp.YoutubeDL", return_value=ydl):
        urls = get_video_urls("https://www.youtube.com/playlist?list=xyz")
    assert urls == [
        "https://www.youtube.com/watch?v=abc",
        "https://www.youtube.com/watch?v=def",
    ]


def test_get_video_urls_single_video():
    ydl = MagicMock()
    ydl.__enter__.return_value = ydl
    ydl.extract_info.return_value = {"id": "abc"}
    with patch("server.steps.download.yt_dlp.YoutubeDL", return_value=ydl):
        urls = get_video_urls("https://www.youtube.com/watch?v=abc")
    assert urls == ["https://www.youtube.com/watch?v=abc"]
