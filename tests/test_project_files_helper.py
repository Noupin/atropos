"""Tests for project file generation helpers."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "server"))

from server.helpers.project_files import (  # noqa: E402  (path adjusted above)
    PROJECT_FILE_SUFFIXES,
    generate_project_files,
)


def read_text(path: Path) -> str:
    """Return the UTF-8 contents of ``path`` as a convenience for assertions."""

    return path.read_text(encoding="utf-8")


def test_generate_project_files_creates_expected_targets(tmp_path: Path) -> None:
    """Every editor target should produce a project file with the expected suffix."""

    video_path = tmp_path / "clip.mp4"
    video_path.write_bytes(b"fake mp4 data")

    project_files = generate_project_files(
        title="Clip Title",
        video_path=video_path,
        duration_seconds=12.5,
        output_dir=tmp_path,
    )

    assert set(project_files) == set(PROJECT_FILE_SUFFIXES)

    for target, details in project_files.items():
        expected_suffix = PROJECT_FILE_SUFFIXES[target]
        assert details.filename == f"clip{expected_suffix}"
        assert details.path.exists()

    premiere_xml = read_text(project_files["premiere"].path)
    resolve_xml = read_text(project_files["resolve"].path)
    final_cut_xml = read_text(project_files["final_cut"].path)

    assert "<name>Clip Title</name>" in premiere_xml
    assert "<asset" in resolve_xml
    assert "<library>" in final_cut_xml


def test_generate_project_files_clamps_duration(tmp_path: Path) -> None:
    """A zero or negative duration should still produce a valid single-frame project."""

    video_path = tmp_path / "zero.mp4"
    video_path.write_bytes(b"data")

    project_files = generate_project_files(
        title="",
        video_path=video_path,
        duration_seconds=0.0,
        output_dir=tmp_path,
    )

    premiere_xml = read_text(project_files["premiere"].path)
    assert "<duration>1</duration>" in premiere_xml

