from server.helpers.description import maybe_append_website_link
from server.integrations.youtube.upload import read_description


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


def test_read_description_appends_link_to_description_only(monkeypatch, tmp_path):
    monkeypatch.setattr(
        "server.helpers.description.INCLUDE_WEBSITE_LINK", True
    )
    monkeypatch.setattr(
        "server.helpers.description.WEBSITE_URL", "https://atropos-video.com"
    )
    desc_file = tmp_path / "desc.txt"
    desc_file.write_text(
        "Full video line\nCredit line\n#funny #cool #wow #amazing #extra",
        encoding="utf-8",
    )
    title, description = read_description(desc_file)
    assert title == "#funny #cool #wow #amazing"
    assert "https://atropos-video.com" not in title
    assert description.endswith("https://atropos-video.com")

