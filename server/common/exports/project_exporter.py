"""Project export orchestration for editor-friendly packages."""

from __future__ import annotations

import hashlib
import importlib
import json
import math
import shutil
import zipfile
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from types import ModuleType
from typing import Dict, Optional

import logging
import config as pipeline_config
from helpers.media import VideoStreamMetadata, probe_video_stream
from library import DEFAULT_ACCOUNT_PLACEHOLDER, LibraryClip, list_account_clips_sync
from .srt import SubtitleCue, parse_srt_file


FRAME_WIDTH = 1080
FRAME_HEIGHT = 1920
FG_VERTICAL_BIAS = 0.04
MEDIA_DIRECTORY_NAME = "Media"
UNIVERSAL_XML_NAME = "UniversalExport.fcpxml"
PREMIERE_PROJECT_NAME = "Project.prproj"
FINALCUT_PROJECT_NAME = "FinalCutProject.fcpxml"
RESOLVE_PROJECT_NAME = "ResolveProject.fcpxml"
MANIFEST_NAME = "export_manifest.json"


logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class ExportedProject:
    """Describes the project archive generated for a clip export."""

    folder_path: Path
    archive_path: Path
    clip_id: str
    account_id: Optional[str]


class ProjectExportError(RuntimeError):
    """Raised when project export fails due to missing data or IO errors."""

    def __init__(self, message: str, *, status_code: int | None = None) -> None:
        super().__init__(message)
        self.status_code = status_code or 400


def _load_otio() -> ModuleType:
    """Return the ``opentimelineio`` module or raise a helpful error."""

    logger.debug("Attempting to import opentimelineio for project export")
    try:
        return importlib.import_module("opentimelineio")
    except ModuleNotFoundError as exc:  # pragma: no cover - optional dependency
        logger.warning(
            "Optional dependency opentimelineio is unavailable",
            exc_info=True,
        )
        raise ProjectExportError(
            "Project export requires the optional 'opentimelineio' dependency. "
            "Install it with `pip install opentimelineio[fcpxml]` and try again.",
            status_code=503,
        ) from exc


def _build_export_folder_name(clip: LibraryClip) -> str:
    created = clip.created_at.astimezone(timezone.utc)
    date_component = created.strftime("%Y%m%d")
    token = hashlib.sha1(clip.clip_id.encode("utf-8")).hexdigest()[:6].upper()
    return f"Short_{date_component}_{token}"


def _ensure_directory(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)


def _copy_media(source: Path, destination_dir: Path) -> Path:
    if not source.exists():
        logger.error("Required media asset missing for export", extra={"path": str(source)})
        raise ProjectExportError(f"Required media asset not found: {source}")
    destination = destination_dir / source.name
    shutil.copy2(source, destination)
    return destination


def _probe_transform_metadata(meta: VideoStreamMetadata) -> Dict[str, object]:
    source_width = meta.width or 1920
    source_height = meta.height or 1080
    layout_name = pipeline_config.RENDER_LAYOUT
    try:
        from steps.render_layouts import get_layout  # type: ignore import-error

        layout = get_layout(layout_name)
        scale_factor = layout.scale_factor(
            source_width,
            source_height,
            FRAME_WIDTH,
            FRAME_HEIGHT,
            pipeline_config.VIDEO_ZOOM_RATIO,
        )
        fg_width = int(round(source_width * scale_factor))
        fg_height = int(round(source_height * scale_factor))
        x_position = layout.x_position(fg_width, FRAME_WIDTH)
    except Exception:  # pragma: no cover - layout import fallback
        scale_factor = (FRAME_HEIGHT * pipeline_config.VIDEO_ZOOM_RATIO) / max(1, source_height)
        fg_width = int(round(source_width * scale_factor))
        fg_height = int(round(source_height * scale_factor))
        x_position = max(0, (FRAME_WIDTH - fg_width) // 2)
        layout_name = "centered"
    center_y = int(FRAME_HEIGHT * (0.5 - FG_VERTICAL_BIAS))
    y_position = max(0, center_y - fg_height // 2)

    return {
        "layout": layout_name,
        "zoom_ratio": pipeline_config.VIDEO_ZOOM_RATIO,
        "vertical_bias": FG_VERTICAL_BIAS,
        "frame": {"width": FRAME_WIDTH, "height": FRAME_HEIGHT},
        "source": {"width": source_width, "height": source_height},
        "scale": scale_factor,
        "position": {"x": x_position, "y": y_position},
        "foreground": {"width": fg_width, "height": fg_height},
    }


def _seconds_to_time_range(seconds: float, fps: float, otio: ModuleType):
    frames = max(1, int(round(seconds * fps)))
    return otio.opentime.TimeRange(
        start_time=otio.opentime.RationalTime(0, fps),
        duration=otio.opentime.RationalTime(frames, fps),
    )


def _build_timeline(
    clip: LibraryClip,
    media_relative_path: Path,
    subtitle_cues: list[SubtitleCue],
    transform_metadata: Dict[str, object],
    video_metadata: VideoStreamMetadata,
    *,
    otio: ModuleType,
):
    fps = float(pipeline_config.OUTPUT_FPS or 30.0)
    duration_seconds = (
        video_metadata.duration
        if video_metadata.duration and math.isfinite(video_metadata.duration)
        else max(0.0, float(clip.end_seconds) - float(clip.start_seconds))
    )
    if duration_seconds <= 0:
        duration_seconds = max(0.5, float(clip.end_seconds) - float(clip.start_seconds))

    timeline = otio.schema.Timeline(name=clip.title)

    available_range = _seconds_to_time_range(duration_seconds, fps, otio)
    media_reference = otio.schema.ExternalReference(
        target_url=media_relative_path.as_posix(),
        available_range=available_range,
    )

    clip_item = otio.schema.Clip(
        name=clip.title,
        media_reference=media_reference,
        source_range=available_range,
        metadata={
            "atropos": {
                "clip_id": clip.clip_id,
                "duration_seconds": duration_seconds,
                "transform": transform_metadata,
            }
        },
    )

    video_track = otio.schema.Track(kind=otio.schema.TrackKind.Video, name="Video")
    video_track.append(clip_item)
    timeline.tracks.append(video_track)

    if subtitle_cues:
        for cue in subtitle_cues:
            cue_duration = max(0.0, cue.end - cue.start)
            if cue_duration <= 0:
                continue
            start_time = otio.opentime.RationalTime(int(round(cue.start * fps)), fps)
            marker = otio.schema.Marker(
                name=cue.text,
                marked_range=otio.opentime.TimeRange(
                    start_time=start_time,
                    duration=otio.opentime.RationalTime(int(round(cue_duration * fps)), fps),
                ),
                color=otio.schema.MarkerColor.CYAN,
                metadata={"atropos": {"text": cue.text}},
            )
            clip_item.markers.append(marker)

    timeline.metadata["atropos"] = {
        "clip_id": clip.clip_id,
        "frame_rate": fps,
        "transform": transform_metadata,
        "subtitles": [cue.__dict__ for cue in subtitle_cues],
    }
    return timeline


def _write_project_files(
    timeline,  # type: ignore[no-untyped-def]
    export_dir: Path,
    *,
    otio: ModuleType,
) -> Dict[str, str]:
    files: Dict[str, str] = {}

    universal_path = export_dir / UNIVERSAL_XML_NAME
    otio.adapters.write_to_file(timeline, str(universal_path), adapter_name="fcp_xml")
    files["universal"] = UNIVERSAL_XML_NAME

    final_cut_path = export_dir / FINALCUT_PROJECT_NAME
    shutil.copy2(universal_path, final_cut_path)
    files["final_cut"] = FINALCUT_PROJECT_NAME

    resolve_path = export_dir / RESOLVE_PROJECT_NAME
    shutil.copy2(universal_path, resolve_path)
    files["resolve"] = RESOLVE_PROJECT_NAME

    premiere_path = export_dir / PREMIERE_PROJECT_NAME
    try:
        otio.adapters.write_to_file(timeline, str(premiere_path), adapter_name="premiere_xml")
    except Exception:
        # Fallback to the universal XML so users can still import the project.
        logger.warning(
            "Falling back to universal XML for Premiere project",
            exc_info=True,
            extra={"premiere_path": str(premiere_path)},
        )
        shutil.copy2(universal_path, premiere_path)
    files["premiere"] = PREMIERE_PROJECT_NAME

    return files


def _write_manifest(
    export_dir: Path,
    clip: LibraryClip,
    media_paths: Dict[str, Path | None],
    project_files: Dict[str, str],
    transform_metadata: Dict[str, object],
) -> Path:
    manifest_payload: Dict[str, object] = {
        "clip": {
            "id": clip.clip_id,
            "title": clip.title,
            "channel": clip.channel,
            "start_seconds": clip.start_seconds,
            "end_seconds": clip.end_seconds,
            "created_at": clip.created_at.isoformat(),
            "account": clip.account_id,
        },
        "media": {
            key: value.as_posix() if value is not None else None
            for key, value in media_paths.items()
        },
        "projects": project_files,
        "transform": transform_metadata,
    }
    manifest_path = export_dir / MANIFEST_NAME
    manifest_path.write_text(json.dumps(manifest_payload, indent=2), encoding="utf-8")
    return manifest_path


def _zip_project(export_dir: Path, archive_path: Path) -> None:
    if archive_path.exists():
        archive_path.unlink()
    with zipfile.ZipFile(archive_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        base_parent = export_dir.parent
        for item in export_dir.rglob("*"):
            archive.write(item, item.relative_to(base_parent))


def build_clip_project_export(
    account_id: Optional[str],
    clip_id: str,
    *,
    destination_root: Path | None = None,
) -> ExportedProject:
    """Generate a zipped project export for ``clip_id``."""

    account_log = account_id or DEFAULT_ACCOUNT_PLACEHOLDER
    logger.info(
        "Building project export",
        extra={"account_id": account_log, "clip_id": clip_id},
    )
    clips = list_account_clips_sync(account_id)
    clip = next((entry for entry in clips if entry.clip_id == clip_id), None)
    if clip is None:
        logger.warning(
            "Clip not found for project export",
            extra={"account_id": account_log, "clip_id": clip_id},
        )
        raise ProjectExportError("Clip not found for export", status_code=404)

    otio = _load_otio()

    project_dir = clip.playback_path.parent.parent
    if not project_dir.exists():
        logger.error(
            "Project directory is unavailable",
            extra={"project_dir": str(project_dir), "clip_id": clip_id},
        )
        raise ProjectExportError("Project directory is unavailable")

    stem = clip.playback_path.stem
    clips_dir = project_dir / "clips"
    subtitles_dir = project_dir / "subtitles"

    raw_clip_path = clips_dir / f"{stem}.mp4"
    vertical_clip_path = clip.playback_path
    subtitle_path = subtitles_dir / f"{stem}.srt"

    if not raw_clip_path.exists():
        raw_clip_path = vertical_clip_path

    export_parent = destination_root or (project_dir / "exports")
    _ensure_directory(export_parent)

    export_folder = export_parent / _build_export_folder_name(clip)
    if export_folder.exists():
        logger.info(
            "Replacing existing export folder",
            extra={"export_folder": str(export_folder)},
        )
        shutil.rmtree(export_folder)
    export_folder.mkdir(parents=True)

    media_dir = export_folder / MEDIA_DIRECTORY_NAME
    media_dir.mkdir()

    copied_raw = _copy_media(raw_clip_path, media_dir)
    copied_vertical = _copy_media(vertical_clip_path, media_dir)
    copied_subtitles: Path | None = None
    if subtitle_path.exists():
        copied_subtitles = _copy_media(subtitle_path, media_dir)

    video_metadata = probe_video_stream(copied_raw)
    subtitle_cues = parse_srt_file(subtitle_path) if subtitle_path.exists() else []

    transform_metadata = _probe_transform_metadata(video_metadata)

    timeline = _build_timeline(
        clip,
        copied_raw.relative_to(export_folder),
        subtitle_cues,
        transform_metadata,
        video_metadata,
        otio=otio,
    )

    project_files = _write_project_files(timeline, export_folder, otio=otio)

    media_manifest = {
        "raw": copied_raw.relative_to(export_folder),
        "vertical": copied_vertical.relative_to(export_folder),
        "subtitles": copied_subtitles.relative_to(export_folder) if copied_subtitles else None,
    }
    _write_manifest(export_folder, clip, media_manifest, project_files, transform_metadata)

    archive_path = export_parent / f"{export_folder.name}.zip"
    _zip_project(export_folder, archive_path)

    logger.info(
        "Project export complete",
        extra={
            "account_id": account_log,
            "clip_id": clip.clip_id,
            "export_folder": str(export_folder),
            "archive_path": str(archive_path),
        },
    )
    return ExportedProject(
        folder_path=export_folder,
        archive_path=archive_path,
        clip_id=clip.clip_id,
        account_id=clip.account_id,
    )


__all__ = ["ExportedProject", "ProjectExportError", "build_clip_project_export"]
