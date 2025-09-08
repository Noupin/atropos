from pathlib import Path

from server import upload_all


def test_youtube_refresh_then_full(monkeypatch):
    calls = []

    def mock_refresh():
        calls.append("refresh")
        return False

    def mock_full():
        calls.append("full")

    monkeypatch.setattr(upload_all, "refresh_creds", mock_refresh)
    monkeypatch.setattr(upload_all, "ensure_creds", mock_full)

    refreshers = upload_all._get_auth_refreshers("u", "p", Path("v.mp4"), "fun")
    refreshers["youtube"]()

    assert calls == ["refresh", "full"]


def test_youtube_refresh_success(monkeypatch):
    calls = []

    def mock_refresh():
        calls.append("refresh")
        return True

    def mock_full():
        calls.append("full")

    monkeypatch.setattr(upload_all, "refresh_creds", mock_refresh)
    monkeypatch.setattr(upload_all, "ensure_creds", mock_full)

    refreshers = upload_all._get_auth_refreshers("u", "p", Path("v.mp4"), "fun")
    refreshers["youtube"]()

    assert calls == ["refresh"]


def test_tiktok_refresh_then_full(monkeypatch):
    calls = []

    def mock_refresh():
        calls.append("refresh")
        return False

    def mock_full():
        calls.append("full")

    monkeypatch.setattr(upload_all, "refresh_tiktok_tokens", mock_refresh)
    monkeypatch.setattr(upload_all, "run_tiktok_auth", mock_full)

    refreshers = upload_all._get_auth_refreshers("u", "p", Path("v.mp4"), "fun")
    refreshers["tiktok"]()

    assert calls == ["refresh", "full"]


def test_tiktok_refresh_success(monkeypatch):
    calls = []

    def mock_refresh():
        calls.append("refresh")
        return True

    def mock_full():
        calls.append("full")

    monkeypatch.setattr(upload_all, "refresh_tiktok_tokens", mock_refresh)
    monkeypatch.setattr(upload_all, "run_tiktok_auth", mock_full)

    refreshers = upload_all._get_auth_refreshers("u", "p", Path("v.mp4"), "fun")
    refreshers["tiktok"]()

    assert calls == ["refresh"]

