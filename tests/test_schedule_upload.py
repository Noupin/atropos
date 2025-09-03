from pathlib import Path
import os
import time

from server.schedule_upload import find_oldest_clip


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

    found = find_oldest_clip(out)
    assert found == (old_video, old_desc)
