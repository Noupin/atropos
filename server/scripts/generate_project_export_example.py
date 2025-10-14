"""Generate a sample project export for documentation and manual testing."""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
from pathlib import Path

try:
    from ..common.exports import ProjectExportError, build_clip_project_export
    from ..library import list_account_clips_sync
except ModuleNotFoundError as exc:  # pragma: no cover - import guard
    if exc.name == "opentimelineio":
        raise SystemExit(
            "OpenTimelineIO is required for project export. Install it with "
            "`pip install OpenTimelineIO` before running this script."
        ) from exc
    raise

SAMPLE_PROJECT_NAME = "SampleProject_20240101"
SAMPLE_CLIP_STEM = "clip_0.00-20.00_r9.0"


def _write_text(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def _generate_video(path: Path, *, width: int, height: int, duration: float) -> bool:
    """Attempt to render a synthetic video file with ``ffmpeg``.

    Returns ``True`` when ``ffmpeg`` is available and produces the clip. Falls
    back to writing placeholder bytes when ``ffmpeg`` cannot be executed so the
    exporter still succeeds (editors may refuse to play the dummy media).
    """

    command = [
        "ffmpeg",
        "-y",
        "-f",
        "lavfi",
        "-i",
        f"color=c=slategray:s={width}x{height}:d={duration}",
        "-vf",
        "drawtext=text='Atropos Sample':fontcolor=white:fontsize=48:x=(w-text_w)/2:y=(h-text_h)/2",
        "-pix_fmt",
        "yuv420p",
        str(path),
    ]
    try:
        subprocess.run(command, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        return True
    except (FileNotFoundError, subprocess.CalledProcessError):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b"placeholder media")
        return False


def _prepare_sample_library(base: Path) -> tuple[Path, Path, Path, bool]:
    """Create a synthetic project tree and return created asset paths."""

    project_dir = base / SAMPLE_PROJECT_NAME
    shorts_dir = project_dir / "shorts"
    clips_dir = project_dir / "clips"
    subtitles_dir = project_dir / "subtitles"

    for directory in (shorts_dir, clips_dir, subtitles_dir):
        directory.mkdir(parents=True, exist_ok=True)

    raw_clip = clips_dir / f"{SAMPLE_CLIP_STEM}.mp4"
    vertical_clip = shorts_dir / f"{SAMPLE_CLIP_STEM}.mp4"
    subtitle_path = subtitles_dir / f"{SAMPLE_CLIP_STEM}.srt"

    horizontal_ok = _generate_video(raw_clip, width=1920, height=1080, duration=12)
    vertical_ok = _generate_video(vertical_clip, width=1080, height=1920, duration=12)

    subtitle_content = """1\n00:00:00,000 --> 00:00:04,000\nWelcome to the Atropos sample export.\n\n2\n00:00:05,000 --> 00:00:08,500\nThis timeline demonstrates captions and layout metadata.\n"""
    _write_text(subtitle_path, subtitle_content)

    candidates = {
        "candidates": [
            {
                "start": 0.0,
                "end": 12.0,
                "rating": 9.5,
                "quote": "Atropos sample clip",
                "reason": "documentation",
            }
        ]
    }
    _write_text(project_dir / "candidates.json", json.dumps(candidates, indent=2))

    description = """Full video: https://example.com/full/sample\nCredit: Atropos Documentation\n"""
    _write_text(project_dir / "description.txt", description)

    status = horizontal_ok and vertical_ok
    return raw_clip, vertical_clip, subtitle_path, status


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("docs/examples/project-export"),
        help="Directory where the export archive should be written.",
    )
    parser.add_argument(
        "--keep-workdir",
        action="store_true",
        help="Keep the temporary library used to stage sample assets.",
    )
    return parser.parse_args()


def main() -> int:
    args = _parse_args()
    output_dir = args.output.expanduser().resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    work_dir = output_dir / "_sample_library"
    if work_dir.exists():
        shutil.rmtree(work_dir)
    work_dir.mkdir(parents=True)

    _raw_clip, _vertical_clip, _subtitle_path, has_real_media = _prepare_sample_library(work_dir)

    previous_out_root = os.environ.get("OUT_ROOT")
    os.environ["OUT_ROOT"] = str(work_dir)
    try:
        clips = list_account_clips_sync(None)
        if not clips:
            raise RuntimeError("Failed to detect the synthetic clip in the library")
        target_clip = clips[0]
        export = build_clip_project_export(None, target_clip.clip_id, destination_root=output_dir)
    except ProjectExportError as exc:
        raise SystemExit(f"Export failed: {exc}") from exc
    finally:
        if previous_out_root is None:
            os.environ.pop("OUT_ROOT", None)
        else:
            os.environ["OUT_ROOT"] = previous_out_root
        if not args.keep_workdir:
            shutil.rmtree(work_dir, ignore_errors=True)

    print(f"Export folder: {export.folder_path}")
    print(f"Export archive: {export.archive_path}")
    if not has_real_media:
        print(
            "Warning: ffmpeg was unavailable so placeholder media files were used. "
            "Editors may refuse to play the dummy footage."
        )
    else:
        print("Synthetic color bars were rendered for both horizontal and vertical clips.")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
