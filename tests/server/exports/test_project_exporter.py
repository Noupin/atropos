from __future__ import annotations

import json
import re
import zipfile
from pathlib import Path

import pytest

import sys

sys.path.append("server")

from common.exports import ProjectExportError, build_clip_project_export
from library import list_account_clips_sync


def _write(path: Path, content: str | bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if isinstance(content, bytes):
        path.write_bytes(content)
    else:
        path.write_text(content, encoding="utf-8")


def _build_sample_project(base: Path) -> tuple[str, Path, Path, Path]:
    project_dir = base / "SampleProject_20240101"
    shorts_dir = project_dir / "shorts"
    clips_dir = project_dir / "clips"
    subtitles_dir = project_dir / "subtitles"

    stem = "clip_0.00-20.00_r9.0"
    vertical = shorts_dir / f"{stem}.mp4"
    raw = clips_dir / f"{stem}.mp4"
    subtitle = subtitles_dir / f"{stem}.srt"

    _write(vertical, b"fake-vertical")
    _write(raw, b"fake-raw")
    _write(
        subtitle,
        """1\n00:00:00,000 --> 00:00:02,000\nHello world!\n\n2\n00:00:02,500 --> 00:00:04,000\nStay curious.""",
    )
    _write(
        project_dir / "candidates.json",
        json.dumps(
            {
                "candidates": [
                    {
                        "start": 0.0,
                        "end": 20.0,
                        "rating": 9.0,
                        "quote": "Sample pull quote",
                        "reason": "demo",
                    }
                ]
            }
        ),
    )

    return stem, vertical, raw, subtitle


def test_builds_project_archive(tmp_path, monkeypatch):
    monkeypatch.setenv("OUT_ROOT", str(tmp_path))
    _stem, vertical, raw, subtitle = _build_sample_project(tmp_path)

    clips = list_account_clips_sync(None)
    assert clips, "Expected the sample project to surface as a library clip"
    clip_id = clips[0].clip_id

    export = build_clip_project_export(None, clip_id)

    assert export.archive_path.exists()
    assert export.folder_path.exists()

    with zipfile.ZipFile(export.archive_path) as archive:
        members = archive.namelist()
        assert members, "Archive should contain files"
        root_folder = members[0].split("/", 1)[0]
        assert re.match(r"Short_\d{8}_[A-F0-9]{6}", root_folder)

        media_dir = f"{root_folder}/Media"
        assert f"{media_dir}/{raw.name}" in members
        assert f"{media_dir}/{vertical.name}" in members
        assert f"{media_dir}/{subtitle.name}" in members

        universal_entry = f"{root_folder}/UniversalExport.fcpxml"
        manifest_entry = f"{root_folder}/export_manifest.json"
        premiere_entry = f"{root_folder}/Project.prproj"
        assert universal_entry in members
        assert premiere_entry in members
        assert manifest_entry in members

        manifest = json.loads(archive.read(manifest_entry).decode("utf-8"))
        assert manifest["media"]["raw"].endswith(raw.name)
        assert manifest["projects"]["universal"] == "UniversalExport.fcpxml"

        universal_xml = archive.read(universal_entry).decode("utf-8")
        assert raw.name in universal_xml


def test_missing_clip_raises(tmp_path, monkeypatch):
    monkeypatch.setenv("OUT_ROOT", str(tmp_path))
    _build_sample_project(tmp_path)

    with pytest.raises(ProjectExportError):
        build_clip_project_export(None, "unknown")


def test_premiere_falls_back_to_universal(tmp_path, monkeypatch):
    monkeypatch.setenv("OUT_ROOT", str(tmp_path))
    _stem, vertical, raw, subtitle = _build_sample_project(tmp_path)

    def fake_write_to_file(timeline, path, adapter_name):  # type: ignore[no-untyped-def]
        target = Path(path)
        if adapter_name == "premiere_xml":
            raise RuntimeError("adapter unavailable")
        target.write_text("<timeline />", encoding="utf-8")

    monkeypatch.setattr(
        "common.exports.project_exporter.otio.adapters.write_to_file",
        fake_write_to_file,
    )

    clips = list_account_clips_sync(None)
    clip_id = clips[0].clip_id

    export = build_clip_project_export(None, clip_id)

    with zipfile.ZipFile(export.archive_path) as archive:
        root_folder = archive.namelist()[0].split("/", 1)[0]
        universal_entry = f"{root_folder}/UniversalExport.fcpxml"
        premiere_entry = f"{root_folder}/Project.prproj"
        universal = archive.read(universal_entry)
        premiere = archive.read(premiere_entry)
        assert universal == premiere

        media_dir = f"{root_folder}/Media"
        assert f"{media_dir}/{raw.name}" in archive.namelist()
        assert f"{media_dir}/{vertical.name}" in archive.namelist()
        assert f"{media_dir}/{subtitle.name}" in archive.namelist()
