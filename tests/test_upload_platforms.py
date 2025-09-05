from pathlib import Path

from server import upload_all


def test_upload_all_platform_subset(monkeypatch, tmp_path):
    called: list[str] = []

    def mock_upload(name):
        def _inner(*args, **kwargs):
            called.append(name)
        return _inner

    monkeypatch.setattr(upload_all, "_upload_youtube", mock_upload("youtube"))
    monkeypatch.setattr(upload_all, "_upload_instagram", mock_upload("instagram"))
    monkeypatch.setattr(upload_all, "_upload_tiktok", mock_upload("tiktok"))
    monkeypatch.setattr(upload_all, "_get_auth_refreshers", lambda u, p: {})

    upload_all.upload_all(
        Path("v.mp4"),
        Path("d.txt"),
        yt_privacy="public",
        yt_category_id="22",
        tt_chunk_size=1,
        tt_privacy="PRIVATE",
        tokens_file=tmp_path / "t.json",
        ig_username="u",
        ig_password="p",
        platforms=["youtube", "tiktok"],
    )

    assert called == ["youtube", "tiktok"]
