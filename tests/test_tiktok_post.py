from server.integrations.tiktok import post as tiktok_post


def test_post_to_tiktok_switch(monkeypatch):
    calls: list[str] = []

    def fake_api(video_path, caption, cover_timestamp_ms=None):
        calls.append("api")
        return {"status": "posted", "post_url": None, "debug": {}}

    def fake_auto(video_path, caption, cover_timestamp_ms=None):
        calls.append("auto")
        return {"status": "posted", "post_url": None, "debug": {}}

    monkeypatch.setattr(tiktok_post, "_post_via_api", fake_api)
    monkeypatch.setattr(tiktok_post, "upload_video_with_autouploader", fake_auto)

    monkeypatch.setattr(tiktok_post, "TIKTOK_UPLOAD_BACKEND", "autouploader")
    tiktok_post.post_to_tiktok("v.mp4", "caption")
    assert calls == ["auto"]

    calls.clear()
    monkeypatch.setattr(tiktok_post, "TIKTOK_UPLOAD_BACKEND", "api")
    tiktok_post.post_to_tiktok("v.mp4", "caption")
    assert calls == ["api"]
