"""Helper utilities for cleaning up pipeline project directories."""

from __future__ import annotations

from pathlib import Path
import shutil
from typing import Iterable


def _remove_path(target: Path) -> None:
    """Best-effort removal for *target* whether it is a file or directory."""

    if target.is_dir():
        shutil.rmtree(target, ignore_errors=True)
        return

    try:
        target.unlink()
    except FileNotFoundError:
        pass
    except IsADirectoryError:
        shutil.rmtree(target, ignore_errors=True)


def _iter_unique(paths: Iterable[Path]) -> list[Path]:
    seen: set[Path] = set()
    unique: list[Path] = []
    for path in paths:
        if path in seen:
            continue
        seen.add(path)
        unique.append(path)
    return unique


def cleanup_project_dir(project_dir: Path, keep: str = "shorts") -> None:
    """Remove all files and folders in *project_dir* except *keep* directory.

    Parameters
    ----------
    project_dir:
        Path to the project directory produced by the pipeline.
    keep:
        Name of the subdirectory that should be preserved. Defaults to "shorts".
    """
    for child in project_dir.iterdir():
        if child.name == keep:
            continue
        if child.is_dir():
            shutil.rmtree(child, ignore_errors=True)
        else:
            try:
                child.unlink()
            except FileNotFoundError:
                pass


def reset_project_for_restart(project_dir: Path, base_name: str, start_step: int) -> None:
    """Remove artefacts generated at or after ``start_step`` for a rerun.

    Parameters
    ----------
    project_dir:
        Directory that stores pipeline outputs for the current video.
    base_name:
        Normalised video name used for derived files (``<base>.mp4``, etc.).
    start_step:
        1-indexed pipeline step that will be re-executed.
    """

    if start_step <= 1:
        # A full restart will rebuild everything, so remove the directory entirely.
        shutil.rmtree(project_dir, ignore_errors=True)
        return

    step_targets: dict[int, list[Path]] = {
        1: [project_dir / f"{base_name}.mp4"],
        2: [project_dir / f"{base_name}.mp3"],
        3: [project_dir / f"{base_name}.txt"],
        4: [project_dir / "silences.json"],
        5: [project_dir / "dialog_ranges.json", project_dir / "segments.json"],
        6: [
            project_dir / "candidates.json",
            project_dir / "candidates_all.json",
            project_dir / "candidates_top.json",
            project_dir / "render_queue.json",
            project_dir / "clips",
            project_dir / "clips_raw",
        ],
        7: [
            project_dir / "subtitles",
            project_dir / "shorts",
            project_dir / f"{base_name}_subtitles.zip",
        ],
    }

    paths_to_remove = []
    for step, targets in step_targets.items():
        if step < start_step:
            continue
        paths_to_remove.extend(targets)

    for target in _iter_unique(paths_to_remove):
        _remove_path(target)

    project_dir.mkdir(parents=True, exist_ok=True)
