from pathlib import Path

from server import upload_all


def test_retry_auth_on_failure(monkeypatch, tmp_path):
    calls = {"upload": 0, "auth": 0}

    def mock_upload(video, desc, privacy, category):
        calls["upload"] += 1
        if calls["upload"] == 1:
            raise RuntimeError("boom")

    def mock_auth():
        calls["auth"] += 1

    monkeypatch.setattr(upload_all, "_upload_youtube", mock_upload)
    monkeypatch.setattr(upload_all, "_upload_instagram", lambda v, d, u, p: None)
    monkeypatch.setattr(
        upload_all, "_upload_tiktok", lambda v, d, cs, p, tf: None
    )
    monkeypatch.setattr(
        upload_all,
        "_get_auth_refreshers",
        lambda u, p, v, a: {"youtube": mock_auth},
    )

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
        account="fun",
    )

    assert calls == {"upload": 2, "auth": 1}
