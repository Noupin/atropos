from server.helpers.formatting import youtube_timestamp_url


def test_youtube_timestamp_url_with_query():
    url = "https://www.youtube.com/watch?v=abc"
    assert youtube_timestamp_url(url, 12.34) == "https://www.youtube.com/watch?v=abc&t=12s"


def test_youtube_timestamp_url_without_query():
    url = "https://youtu.be/abc"
    assert youtube_timestamp_url(url, 12.34) == "https://youtu.be/abc?t=12s"

