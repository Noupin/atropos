from __future__ import annotations

"""Select and upload the oldest clip in the ``out`` directory."""

from pathlib import Path

from upload_all import run

OUT_DIR = Path("out")


def find_oldest_clip(base: Path = OUT_DIR) -> tuple[Path, Path] | None:
    """Return the oldest video and matching description from ``base``.

    The search iterates over folders in ``base``, choosing the oldest one and
    then the oldest ``.mp4`` in its ``shorts`` subdirectory that has a
    corresponding ``.txt`` description file.
    """

    folders = sorted(
        (p for p in base.iterdir() if p.is_dir()), key=lambda p: p.stat().st_mtime
    )
    for folder in folders:
        shorts = folder / "shorts"
        if not shorts.is_dir():
            continue
        videos = sorted(shorts.glob("*.mp4"), key=lambda p: p.stat().st_mtime)
        for video in videos:
            desc = video.with_suffix(".txt")
            if desc.exists():
                return video, desc
    return None


def main() -> None:
    clip = find_oldest_clip()
    if not clip:
        print("No videos found for upload")
        return
    video, desc = clip
    run(video=video, desc=desc)


if __name__ == "__main__":
    main()
