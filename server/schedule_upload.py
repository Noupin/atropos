from __future__ import annotations

"""Select and upload the oldest clip in the ``out`` directory.

Each upload account has its own output folder under the top-level ``out``
directory. Tokens for each platform are also namespaced by account during
upload. The appropriate account can be selected by passing the ``account``
argument to :func:`main` or by setting the ``ACCOUNT_NAME`` environment
variable.
"""

from pathlib import Path
from typing import Sequence
import argparse
import os
import shutil

from upload_all import run

# Root directory that contains sub-folders for each account. The default account
# uses this directory directly, e.g. ``out/<project>``. Other accounts place their
# projects under ``out/<account>/<project>``.
# Inside the container, the volume is mounted at /app/out, while locally it may be ./out
# User can override via environment variable OUT_ROOT
OUT_ROOT = Path(os.environ.get("OUT_ROOT", "/app/out"))


def find_oldest_clip(base: Path = OUT_ROOT) -> tuple[Path, Path] | None:
    """Return the oldest video and matching description from ``base``.

    The search iterates over folders in ``base``, choosing the oldest one and
    then the oldest ``.mp4`` in its ``shorts`` subdirectory that has a
    corresponding ``.txt`` description file.
    """

    if not base.exists() or not base.is_dir():
        return None

    folders = sorted(
        (p for p in base.iterdir() if p.is_dir()), key=lambda p: p.stat().st_mtime
    )
    for folder in folders:
        shorts = folder / "shorts"
        if not shorts.is_dir():
            continue
        videos = sorted(
            shorts.glob("*.mp4"), key=lambda p: (p.stat().st_mtime, p.name)
        )
        for video in videos:
            desc = video.with_suffix(".txt")
            if desc.exists():
                return video, desc
    return None


def _tidy_empty_dirs(shorts: Path, project: Path) -> None:
    """Delete the project directory when ``shorts`` becomes empty."""

    if not any(shorts.iterdir()):
        shutil.rmtree(project)


def list_accounts(base: Path = OUT_ROOT) -> list[str | None]:
    """Return all accounts with available projects under ``base``.

    The default account (projects directly inside ``base``) is represented by
    ``None``. Additional accounts are subdirectories of ``base`` that contain at
    least one project folder with a ``shorts`` subdirectory.
    """

    if not base.exists() or not base.is_dir():
        return []

    accounts: list[str | None] = []

    if any((p / "shorts").is_dir() for p in base.iterdir() if p.is_dir()):
        accounts.append(None)

    for d in base.iterdir():
        if not d.is_dir():
            continue
        if any((p / "shorts").is_dir() for p in d.iterdir() if p.is_dir()):
            accounts.append(d.name)

    return accounts


def main(account: str | None = None, platforms: Sequence[str] | None = None) -> None:
    """Upload the oldest clip for the selected account.

    Parameters
    ----------
    account:
        The account name. If ``None``, the value is read from the ``ACCOUNT_NAME``
        environment variable. When no account is specified, the default ``out``
        directory is used.
    platforms:
        Optional iterable of platform names to upload to. When omitted, uploads
        are attempted on all supported platforms.
    """

    account = account or os.environ.get("ACCOUNT_NAME") or os.environ.get("ACCOUNT_KIND")

    out_dir = OUT_ROOT / account if account else OUT_ROOT

    clip = find_oldest_clip(out_dir)
    if not clip:
        print(f"No videos found for upload (searched: {out_dir})")
        return
    video, desc = clip
    project = video.parent.parent
    try:
        run(video=video, desc=desc, account=account, platforms=platforms)
    finally:
        for f in video.parent.glob(f"{video.stem}.*"):
            if f.is_file():
                f.unlink(missing_ok=True)
        _tidy_empty_dirs(video.parent, project)


def batch(
    accounts: Sequence[str | None] | None = None,
    platforms: Sequence[str] | None = None,
) -> None:
    """Upload the oldest clip for each selected account.

    Parameters
    ----------
    accounts:
        Iterable of account names. ``None`` processes the default account. When
        the iterable is omitted, all accounts discovered under :data:`OUT_ROOT`
        are processed sequentially.
    platforms:
        Optional iterable of platform names to upload to. When omitted, uploads
        are attempted on all supported platforms.
    """

    if accounts is None:
        accounts = list_accounts(OUT_ROOT)

    for account in accounts:
        main(account=account, platforms=platforms)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Upload the oldest clip per account")
    parser.add_argument(
        "-a",
        "--account",
        dest="accounts",
        nargs="*",
        help="Account names to process. If omitted, all accounts are processed.",
    )
    parser.add_argument(
        "-p",
        "--platform",
        dest="platforms",
        nargs="*",
        help="Platform names to upload to (e.g. youtube, tiktok)",
    )
    args = parser.parse_args()

    batch(accounts=args.accounts, platforms=args.platforms)
