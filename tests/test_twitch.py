from server.steps.download import get_video_urls, download_transcript


def test_get_video_urls_non_youtube():
    url = "https://www.twitch.tv/videos/12345"
    assert get_video_urls(url) == [url]


def test_download_transcript_non_youtube(tmp_path):
    url = "https://www.twitch.tv/videos/12345"
    out = tmp_path / "t.txt"
    assert download_transcript(url, str(out)) is False
    assert not out.exists()
