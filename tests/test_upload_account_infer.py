from pathlib import Path
from typing import Sequence
import json

import server.upload_all as upload_all


def test_run_infers_account_from_path(tmp_path, monkeypatch) -> None:
    out_root = tmp_path / "out"
    account = "funny"
    folder = out_root / account / "proj" / "shorts"
    folder.mkdir(parents=True)
    video = folder / "clip.mp4"
    video.write_bytes(b"a")
    desc = folder / "clip.txt"
    desc.write_text("d")

    tokens_dir = tmp_path / "tokens"
    (tokens_dir / account).mkdir(parents=True)
    (tokens_dir / account / "instagram.json").write_text(
        json.dumps({"username": "u", "password": "p"})
    )

    calls: list[str | None] = []

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
        platforms: Sequence[str] | None = None,
    ) -> None:
        calls.append(account)

    monkeypatch.setattr(upload_all, "upload_all", fake_upload_all)
    monkeypatch.setenv("OUT_ROOT", str(out_root))

    upload_all.run(
        folder=folder,
        yt_privacy="public",
        yt_category_id="22",
        tt_chunk_size=1,
        tt_privacy="PRIVATE",
        tokens_dir=tokens_dir,
    )

    assert calls == [account]
