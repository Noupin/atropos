"""Helper utilities for cleaning up pipeline project directories."""

from pathlib import Path
import shutil


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
