from pathlib import Path

from server import upload_all


def test_failure_email_contains_context(monkeypatch, tmp_path):
    def fail_upload(*args, **kwargs):
        raise RuntimeError("boom")

    monkeypatch.setattr(upload_all, "_upload_youtube", fail_upload)
    monkeypatch.setattr(upload_all, "_upload_instagram", lambda *a, **k: None)
    monkeypatch.setattr(upload_all, "_upload_tiktok", lambda *a, **k: None)
    monkeypatch.setattr(
        upload_all, "_get_auth_refreshers", lambda u, p, v, a: {}
    )

    emails: list[tuple[str, str]] = []

    def fake_email(subject: str, body: str) -> None:
        emails.append((subject, body))

    monkeypatch.setattr(upload_all, "send_failure_email", fake_email)

    video = Path("vid.mp4")
    upload_all.upload_all(
        video,
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

    assert len(emails) == 1
    subject, body = emails[0]
    assert "youtube" in subject.lower()
    assert "fun" in body
    assert str(video) in body
    assert "youtube" in body.lower()
    assert "boom" in body
    assert "Time:" in body
