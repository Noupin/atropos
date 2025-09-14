from __future__ import annotations

"""Report ready videos and days of content per account."""

from pathlib import Path
import os

from schedule_upload import get_out_root, list_accounts

CRON_FILE = Path(__file__).resolve().parent.parent / "docker" / "cron"


def uploads_per_day(cron_path: Path | None = None) -> int:
    """Return the number of uploads scheduled per day.

    The count is derived from the hour field of lines in ``cron_path`` that
    execute ``schedule_upload.py``. Environment variable lines and comments are
    ignored.
    """

    cron_path = cron_path or CRON_FILE
    if not cron_path.exists():
        return 0
    uploads = 0
    for line in cron_path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" in line:
            continue
        if "schedule_upload.py" not in line:
            continue
        parts = line.split()
        if len(parts) < 2:
            continue
        hours_field = parts[1]
        uploads += len([h for h in hours_field.split(",") if h])
    return uploads


def count_videos(account: str | None = None, base: Path | None = None) -> int:
    """Count ready videos for ``account`` under ``base``.

    A video is considered ready when an ``.mp4`` file has a matching ``.txt``
    description in a ``shorts`` subdirectory.
    """

    base = base or get_out_root()
    out_dir = base / account if account else base
    if not out_dir.exists():
        return 0
    count = 0
    for project in out_dir.iterdir():
        shorts = project / "shorts"
        if not shorts.is_dir():
            continue
        for video in shorts.glob("*.mp4"):
            if video.with_suffix(".txt").exists():
                count += 1
    return count


def main() -> None:
    """Print the number of ready videos and days of content per account."""

    uploads = uploads_per_day()
    if uploads == 0:
        print("No uploads scheduled.")
        return

    base = get_out_root()
    accounts = list_accounts(base)
    for account in accounts:
        name = account if account is not None else "(default)"
        videos = count_videos(account, base)
        days = videos / uploads
        print(f"{name}: {videos} videos, {days:.2f} days")


if __name__ == "__main__":
    main()
