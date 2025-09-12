from pathlib import Path
import json
import os

import server.upload_all as upload_all


def test_run_sets_instagram_paths(tmp_path, monkeypatch) -> None:
    video = tmp_path / "clip.mp4"
    video.write_bytes(b"a")
    desc = tmp_path / "clip.txt"
    desc.write_text("d")

    tokens_dir = tmp_path / "tokens"
    account = "acct"
    account_dir = tokens_dir / account
    account_dir.mkdir(parents=True)
    (account_dir / "instagram.json").write_text(
        json.dumps({"username": "u", "password": "p"})
    )

    captured: list[str] = []

    def fake_upload_all(
        video: Path,
        desc: Path,
        yt_privacy: str,
        yt_category_id: str,
        tt_chunk_size: int,
        tt_privacy: str,
        tokens_file: Path,
        ig_username: str,
        ig_password: str,
        *,
        account: str | None = None,
        platforms=None,
    ) -> None:
        captured.extend(
            [
                os.environ.get("IG_SESSION_FILE", ""),
                os.environ.get("IG_STATE_FILE", ""),
            ]
        )

    monkeypatch.setattr(upload_all, "upload_all", fake_upload_all)

    upload_all.run(
        video=video,
        desc=desc,
        yt_privacy="public",
        yt_category_id="22",
        tt_chunk_size=1,
        tt_privacy="PRIVATE",
        tokens_dir=tokens_dir,
        account=account,
    )

    expected_session = account_dir / "instagram_session.json"
    expected_state = account_dir / "instagram_state.json"
    assert captured == [str(expected_session), str(expected_state)]
