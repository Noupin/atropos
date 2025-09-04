from server.helpers.description import maybe_append_website_link


def test_maybe_appends_website_link_when_enabled(monkeypatch):
    monkeypatch.setattr(
        "server.helpers.description.INCLUDE_WEBSITE_LINK", True
    )
    monkeypatch.setattr(
        "server.helpers.description.WEBSITE_URL", "https://atropos-video.com"
    )
    text = "Full video: link"
    result = maybe_append_website_link(text)
    assert result.endswith("https://atropos-video.com")


def test_maybe_skips_website_link_when_disabled(monkeypatch):
    monkeypatch.setattr(
        "server.helpers.description.INCLUDE_WEBSITE_LINK", False
    )
    monkeypatch.setattr(
        "server.helpers.description.WEBSITE_URL", "https://atropos-video.com"
    )
    text = "Full video: link"
    result = maybe_append_website_link(text)
    assert "https://atropos-video.com" not in result
