from pathlib import Path
from typing import Sequence
import os
import time

import server.schedule_upload as schedule_upload


def test_find_oldest_clip(tmp_path: Path) -> None:
    out = tmp_path / "out"
    out.mkdir()

    old_folder = out / "old"
    new_folder = out / "new"
    (old_folder / "shorts").mkdir(parents=True)
    (new_folder / "shorts").mkdir(parents=True)

    old_video = old_folder / "shorts" / "a.mp4"
    old_video.write_bytes(b"a")
    old_desc = old_video.with_suffix(".txt")
    old_desc.write_text("desc1")

    now = time.time()
    os.utime(old_folder, (now - 10, now - 10))
    os.utime(old_video, (now - 10, now - 10))
    os.utime(old_desc, (now - 10, now - 10))

    new_video = new_folder / "shorts" / "b.mp4"
    new_video.write_bytes(b"b")
    new_desc = new_video.with_suffix(".txt")
    new_desc.write_text("desc2")

    found = schedule_upload.find_oldest_clip(out)
    assert found == (old_video, old_desc)


def test_main_cleans_and_deletes(tmp_path: Path, monkeypatch) -> None:
    out = tmp_path / "out"
    project = out / "proj"
    shorts = project / "shorts"
    shorts.mkdir(parents=True)
    video = shorts / "clip.mp4"
    video.write_bytes(b"a")
    desc = video.with_suffix(".txt")
    desc.write_text("desc")
    extra_clip = shorts / "clip.srt"
    extra_clip.write_text("subs")
    extra_file = project / "note.txt"
    extra_file.write_text("junk")
    extra_dir = project / "raw"
    extra_dir.mkdir()
    (extra_dir / "raw.txt").write_text("raw")

    calls: list[tuple[Path, Path, str | None]] = []

    def fake_run(*, video: Path, desc: Path, niche=None, **kwargs) -> None:
        calls.append((video, desc, niche))

    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(schedule_upload, "run", fake_run)
    monkeypatch.setattr(schedule_upload, "OUT_ROOT", Path("out"))

    schedule_upload.main()

    assert len(calls) == 1
    assert calls[0] == (
        video.relative_to(tmp_path),
        desc.relative_to(tmp_path),
        None,
    )
    assert not video.exists()
    assert not desc.exists()
    assert not extra_clip.exists()
    assert not extra_file.exists()
    assert not extra_dir.exists()
    assert not shorts.exists()
    assert not project.exists()


def test_project_not_deleted_until_last_short(tmp_path: Path, monkeypatch) -> None:
    out = tmp_path / "out"
    project = out / "proj"
    shorts = project / "shorts"
    shorts.mkdir(parents=True)
    video1 = shorts / "a.mp4"
    video1.write_bytes(b"a")
    desc1 = video1.with_suffix(".txt")
    desc1.write_text("desc1")
    video2 = shorts / "b.mp4"
    video2.write_bytes(b"b")
    desc2 = video2.with_suffix(".txt")
    desc2.write_text("desc2")
    extra = project / "note.txt"
    extra.write_text("keep")

    calls: list[tuple[Path, Path, str | None]] = []

    def fake_run(*, video: Path, desc: Path, niche=None, **kwargs) -> None:
        calls.append((video, desc, niche))

    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(schedule_upload, "run", fake_run)
    monkeypatch.setattr(schedule_upload, "OUT_ROOT", Path("out"))

    # First upload removes only the first short and leaves the project intact
    schedule_upload.main()
    assert len(calls) == 1
    assert not video1.exists()
    assert not desc1.exists()
    assert video2.exists()
    assert desc2.exists()
    assert extra.exists()
    assert project.exists()

    # Second upload removes remaining files and the project folder
    schedule_upload.main()
    assert len(calls) == 2
    assert not video2.exists()
    assert not desc2.exists()
    assert not extra.exists()
    assert not project.exists()


def test_main_respects_kind(tmp_path: Path, monkeypatch) -> None:
    out = tmp_path / "out" / "alt"
    project = out / "proj"
    shorts = project / "shorts"
    shorts.mkdir(parents=True)
    video = shorts / "clip.mp4"
    video.write_bytes(b"a")
    desc = video.with_suffix(".txt")
    desc.write_text("desc")

    calls: list[tuple[Path, Path, str | None]] = []

    def fake_run(*, video: Path, desc: Path, niche=None, **kwargs) -> None:
        calls.append((video, desc, niche))

    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(schedule_upload, "run", fake_run)
    monkeypatch.setattr(schedule_upload, "OUT_ROOT", Path("out"))

    schedule_upload.main(kind="alt")

    assert len(calls) == 1
    assert calls[0] == (
        video.relative_to(tmp_path),
        desc.relative_to(tmp_path),
        "alt",
    )
    assert not video.exists()
    assert not desc.exists()


def test_main_accepts_platforms(tmp_path: Path, monkeypatch) -> None:
    out = tmp_path / "out"
    project = out / "proj"
    shorts = project / "shorts"
    shorts.mkdir(parents=True)
    video = shorts / "clip.mp4"
    video.write_bytes(b"a")
    desc = video.with_suffix(".txt")
    desc.write_text("desc")

    platforms_seen: list[Sequence[str] | None] = []

    def fake_run(*, video: Path, desc: Path, niche=None, platforms=None, **kw) -> None:
        platforms_seen.append(platforms)

    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(schedule_upload, "run", fake_run)
    monkeypatch.setattr(schedule_upload, "OUT_ROOT", Path("out"))

    schedule_upload.main(platforms=["youtube", "tiktok"])

    assert platforms_seen == [["youtube", "tiktok"]]
