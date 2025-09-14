from pathlib import Path

import server.video_inventory as inventory


def test_uploads_per_day(tmp_path: Path) -> None:
    cron = tmp_path / "cron"
    cron.write_text(
        "SHELL=/bin/sh\n0 1,7,12,20 * * * root cd /app/server && /usr/bin/python schedule_upload.py\n"
    )
    assert inventory.uploads_per_day(cron) == 4


def test_count_videos(tmp_path: Path, monkeypatch) -> None:
    out = tmp_path / "out"
    default_short = out / "proj" / "shorts"
    default_short.mkdir(parents=True)
    (default_short / "a.mp4").write_bytes(b"a")
    (default_short / "a.txt").write_text("desc")

    alt_short = out / "alt" / "proj" / "shorts"
    alt_short.mkdir(parents=True)
    (alt_short / "b.mp4").write_bytes(b"b")
    (alt_short / "b.txt").write_text("desc")

    monkeypatch.setenv("OUT_ROOT", str(out))
    assert inventory.count_videos() == 1
    assert inventory.count_videos("alt") == 1


def test_main_reports_days(tmp_path: Path, monkeypatch, capsys) -> None:
    out = tmp_path / "out" / "proj" / "shorts"
    out.mkdir(parents=True)
    (out / "a.mp4").write_bytes(b"a")
    (out / "a.txt").write_text("desc")

    monkeypatch.setenv("OUT_ROOT", str(tmp_path / "out"))
    monkeypatch.setattr(inventory, "uploads_per_day", lambda *a, **k: 2)

    inventory.main()
    captured = capsys.readouterr().out.strip().splitlines()
    assert captured == ["(default): 1 videos, 0.50 days"]
