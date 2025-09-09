from pathlib import Path
from typing import Sequence
import json

import server.upload_all as upload_all


def test_run_folder_deletes_files(tmp_path, monkeypatch) -> None:
    project = tmp_path / "proj"
    folder = project / "shorts"
    folder.mkdir(parents=True)
    video = folder / "clip.mp4"
    video.write_bytes(b"a")
    desc = folder / "clip.txt"
    desc.write_text("d")
    extra = folder / "clip.srt"
    extra.write_text("subs")

    calls: list[tuple[Path, Path]] = []

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
        calls.append((video, desc))

    monkeypatch.setattr(upload_all, "upload_all", fake_upload_all)

    (tmp_path / "instagram.json").write_text(
        json.dumps({"username": "u", "password": "p"})
    )

    upload_all.run(
        folder=folder,
        yt_privacy="public",
        yt_category_id="22",
        tt_chunk_size=1,
        tt_privacy="PRIVATE",
        tokens_dir=tmp_path,
    )

    assert calls == [(video, desc)]
    assert not video.exists()
    assert not desc.exists()
    assert not extra.exists()
    assert not folder.exists()
    assert not project.exists()

