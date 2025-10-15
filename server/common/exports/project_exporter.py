"""Project export orchestration for editor-friendly packages."""

from __future__ import annotations

import hashlib
import importlib
import json
import math
import shutil
import os
import zipfile
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from types import ModuleType
from typing import Dict, Optional

import logging
import config as pipeline_config
from helpers.media import VideoStreamMetadata, probe_video_stream
from library import DEFAULT_ACCOUNT_PLACEHOLDER, LibraryClip, list_account_clips_sync
from .native_projects import (
    build_srt_entries,
    generate_premiere_project,
    save_text_file,
)
from .srt import SubtitleCue, parse_srt_file


FRAME_WIDTH = 1080
FRAME_HEIGHT = 1920
FG_VERTICAL_BIAS = 0.04
MEDIA_DIRECTORY_NAME = "Media"
UNIVERSAL_XML_NAME = "UniversalExport.fcpxml"
PREMIERE_PROJECT_NAME = "Project.prproj"
FINALCUT_PROJECT_NAME = "FinalCutProject.fcpxml"
RESOLVE_PROJECT_NAME = "ResolveProject.drp"
RESOLVE_FCPXML_NAME = "ResolveProject.fcpxml"
EXPORT_LOG_NAME = "export_log.txt"
RESOLVE_ADAPTER_CANDIDATES = (
    "davinci_resolve",
    "resolve",
    "davinciresolve",
)
ADAPTER_REQUIRED_BY_EXTENSION = {
    ".drp": RESOLVE_ADAPTER_CANDIDATES,
}
MANIFEST_NAME = "export_manifest.json"


logger = logging.getLogger(__name__)


SUPPORTED_EFFECTS = {
    "scale",
    "position",
    "crop",
    "fade",
    "subtitle_overlay",
}

RESOLVE_SCRIPT_ENV = "RESOLVE_DRP_EXPORT_SCRIPT"


@dataclass
class CompatibilityLogEntry:
    """Represents a single compatibility log entry."""

    severity: str
    message: str
    context: Dict[str, object] = field(default_factory=dict)


@dataclass
class CompatibilityLog:
    """Aggregates compatibility and export notes for the generated project."""

    entries: list[CompatibilityLogEntry] = field(default_factory=list)

    def add(self, severity: str, message: str, **context: object) -> None:
        entry = CompatibilityLogEntry(severity=severity.upper(), message=message, context=dict(context))
        logger.log(
            logging.INFO if severity.lower() == "info" else logging.WARNING,
            message,
            extra={"compatibility_context": context} if context else None,
        )
        self.entries.append(entry)

    def info(self, message: str, **context: object) -> None:
        self.add("info", message, **context)

    def warning(self, message: str, **context: object) -> None:
        self.add("warning", message, **context)

    def write(self, destination: Path) -> None:
        if not self.entries:
            self.info("No compatibility adjustments were required")
        lines = ["Atropos Project Export Compatibility Log", "="]
        timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%SZ")
        lines.append(f"Generated at: {timestamp}")
        lines.append("")
        for entry in self.entries:
            lines.append(f"[{entry.severity}] {entry.message}")
            for key, value in entry.context.items():
                lines.append(f"    {key}: {value}")
        destination.write_text("\n".join(lines), encoding="utf-8")


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


def _load_fcp_xml_adapter() -> ModuleType:
    """Return the vendored FCPXML adapter bound to opentimelineio."""

    return importlib.import_module(
        "common.exports.vendor.otio_fcp_adapter.fcp_xml"
    )


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


def _summarise_effects(
    clip: LibraryClip,
    subtitle_cues: list[SubtitleCue],
    transform_metadata: Dict[str, object],
    log: CompatibilityLog,
) -> list[Dict[str, object]]:
    """Return a list describing detected effects and their support state."""

    summary: list[Dict[str, object]] = []

    if subtitle_cues:
        summary.append({"type": "subtitle_overlay", "supported": True, "count": len(subtitle_cues)})
        log.info("Subtitle overlays detected", count=len(subtitle_cues))

    for key in ("scale", "position", "crop"):
        if key in transform_metadata:
            summary.append({"type": key, "supported": True})

    if clip.has_adjustments:
        log.warning(
            "Clip adjustments detected; exporting baked transforms only",
            clip_id=clip.clip_id,
        )
        summary.append({"type": "adjustments", "supported": False})
    else:
        log.info("No advanced adjustments detected", clip_id=clip.clip_id)

    summary.append({"type": "fade", "supported": False, "note": "Placeholder track only"})

    exported = {entry["type"] for entry in summary if entry.get("supported")}
    missing_supported = sorted(effect for effect in SUPPORTED_EFFECTS if effect not in exported)
    if missing_supported:
        log.info("No instances of some supported effects detected", missing=missing_supported)

    return summary


def _build_timeline(
    clip: LibraryClip,
    raw_media_relative_path: Path,
    final_media_relative_path: Path,
    subtitle_cues: list[SubtitleCue],
    transform_metadata: Dict[str, object],
    video_metadata: VideoStreamMetadata,
    *,
    otio: ModuleType,
    log: CompatibilityLog,
    effects_summary: list[Dict[str, object]],
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
    final_reference = otio.schema.ExternalReference(
        target_url=final_media_relative_path.as_posix(),
        available_range=available_range,
    )
    final_clip_item = otio.schema.Clip(
        name=f"{clip.title} (Short)",
        media_reference=final_reference,
        source_range=available_range,
        metadata={
            "atropos": {
                "clip_id": clip.clip_id,
                "duration_seconds": duration_seconds,
                "transform": transform_metadata,
                "role": "final_short",
            }
        },
    )

    primary_track = otio.schema.Track(kind=otio.schema.TrackKind.Video, name="Final Short")
    primary_track.append(final_clip_item)
    timeline.tracks.append(primary_track)
    log.info("Added final short track", track="Final Short", media=str(final_media_relative_path))

    raw_reference = otio.schema.ExternalReference(
        target_url=raw_media_relative_path.as_posix(),
        available_range=available_range,
    )
    raw_clip_item = otio.schema.Clip(
        name=f"{clip.title} (Source)",
        media_reference=raw_reference,
        source_range=available_range,
        metadata={
            "atropos": {
                "clip_id": clip.clip_id,
                "role": "source_reference",
                "original_start_seconds": clip.original_start_seconds,
                "original_end_seconds": clip.original_end_seconds,
            }
        },
    )
    source_track = otio.schema.Track(kind=otio.schema.TrackKind.Video, name="Source Reference")
    source_track.append(raw_clip_item)
    timeline.tracks.append(source_track)
    log.info("Added source reference track", track="Source Reference", media=str(raw_media_relative_path))

    if subtitle_cues:
        subtitle_track = otio.schema.Track(kind=otio.schema.TrackKind.Video, name="Subtitles")
        for idx, cue in enumerate(subtitle_cues, start=1):
            cue_duration = max(0.0, cue.end - cue.start)
            if cue_duration <= 0:
                continue
            start_time = otio.opentime.RationalTime(int(round(cue.start * fps)), fps)
            subtitle_clip = otio.schema.Clip(
                name=f"Subtitle {idx}",
                media_reference=otio.schema.GeneratorReference(
                    generator_kind="text",
                    parameters={"text": cue.text},
                ),
                source_range=otio.opentime.TimeRange(
                    start_time=start_time,
                    duration=otio.opentime.RationalTime(int(round(cue_duration * fps)), fps),
                ),
                metadata={
                    "atropos": {
                        "text": cue.text,
                        "start": cue.start,
                        "end": cue.end,
                        "role": "subtitle_overlay",
                    }
                },
            )
            subtitle_track.append(subtitle_clip)
        timeline.tracks.append(subtitle_track)
        log.info("Added subtitles track", cues=len(subtitle_cues))
    else:
        log.info("No subtitle cues detected; skipping subtitle track")

    transform_track = otio.schema.Track(kind=otio.schema.TrackKind.Video, name="Transforms & Effects")
    transform_clip = otio.schema.Clip(
        name="Transform Stack",
        media_reference=otio.schema.GeneratorReference(
            generator_kind="effect",
            parameters={"type": "transform"},
        ),
        source_range=available_range,
        metadata={"atropos": {"effects": transform_metadata, "role": "transform"}},
    )
    transform_track.append(transform_clip)
    timeline.tracks.append(transform_track)
    log.info("Added transform track", keys=sorted(transform_metadata.keys()))

    transitions_track = otio.schema.Track(kind=otio.schema.TrackKind.Video, name="Transitions & Fades")
    transitions_track.append(
        otio.schema.Gap(
            duration=available_range.duration,
            metadata={
                "atropos": {
                    "note": "No transitions detected; gap placeholder",
                    "role": "transitions",
                }
            },
        )
    )
    timeline.tracks.append(transitions_track)
    log.info("Added transitions placeholder track")

    timeline.metadata["atropos"] = {
        "clip_id": clip.clip_id,
        "frame_rate": fps,
        "transform": transform_metadata,
        "subtitles": [cue.__dict__ for cue in subtitle_cues],
        "layers": [track.name for track in timeline.tracks],
        "effects": effects_summary,
    }
    return timeline, duration_seconds, fps


def _available_adapter_names(otio: ModuleType) -> tuple[set[str], dict[str, str]]:
    """Return adapter names plus a case-insensitive lookup."""

    try:
        adapters = otio.adapters.available_adapter_names()
    except Exception:  # pragma: no cover - defensive guard
        logger.exception("Failed to read opentimelineio adapters", exc_info=True)
        return set(), {}
    lowered = {name.lower() for name in adapters}
    lookup = {name.lower(): name for name in adapters}
    return lowered, lookup


def _is_supported_project_extension(filename: str, available_adapters: set[str]) -> bool:
    """Return ``True`` if ``filename`` is supported by the available OTIO adapters."""

    extension = Path(filename).suffix.lower()
    adapter_candidates = ADAPTER_REQUIRED_BY_EXTENSION.get(extension)
    if adapter_candidates is None:
        return True
    return any(candidate in available_adapters for candidate in adapter_candidates)


def _annotate_fallback_xml(xml_payload: str, *, reason: str) -> str:
    """Insert a comment noting why a fallback Resolve export was produced."""

    comment = f"<!-- Resolve fallback: {reason} -->"
    stripped = xml_payload.lstrip()
    if stripped.startswith("<?xml"):
        marker = xml_payload.find("\n")
        if marker >= 0:
            return xml_payload[: marker + 1] + comment + "\n" + xml_payload[marker + 1 :]
        return xml_payload + "\n" + comment
    return comment + "\n" + xml_payload


def _attempt_resolve_drp_export(
    timeline,  # type: ignore[no-untyped-def]
    destination: Path,
    *,
    adapter_name: str,
    otio: ModuleType,
    log: CompatibilityLog,
) -> bool:
    """Try to export a Resolve DRP using an available OTIO adapter or script."""

    script_path = os.environ.get(RESOLVE_SCRIPT_ENV)
    if script_path:
        log.info("Resolve DRP export script configured", script=script_path)
        if not Path(script_path).exists():
            log.warning("Configured Resolve export script missing", script=script_path)
        else:  # pragma: no cover - requires external Resolve automation
            try:
                subprocess_result = shutil.which(script_path)
                if subprocess_result is None:
                    log.warning("Resolve export script is not executable", script=script_path)
                else:
                    log.warning(
                        "Resolve export script support is not implemented in this environment",
                        script=script_path,
                    )
            except Exception:
                log.warning("Failed to invoke Resolve export script", script=script_path)

    try:
        otio.adapters.write_to_file(  # type: ignore[attr-defined]
            timeline,
            str(destination),
            adapter_name=adapter_name,
        )
        log.info(
            "Resolve project generated via opentimelineio adapter",
            adapter=adapter_name,
            path=str(destination),
        )
        return True
    except Exception:  # pragma: no cover - adapter failure path
        logger.exception("Resolve adapter failed during DRP export", extra={"adapter": adapter_name})
        log.warning("Resolve adapter failed; falling back to FCPXML", adapter=adapter_name)
        return False


def _write_resolve_project(
    timeline,  # type: ignore[no-untyped-def]
    export_dir: Path,
    *,
    universal_xml: str,
    available_adapters: set[str],
    adapter_lookup: dict[str, str],
    otio: ModuleType,
    clip: LibraryClip,

    log: CompatibilityLog,
) -> tuple[str, str]:
    """Write the Resolve project file and a fallback FCPXML copy."""

    fallback_reason = "Resolve adapter unavailable"
    primary_filename = RESOLVE_FCPXML_NAME

    adapter_key = next(
        (candidate for candidate in RESOLVE_ADAPTER_CANDIDATES if candidate in available_adapters),
        None,
    )
    if adapter_key:
        adapter_name = adapter_lookup.get(adapter_key, adapter_key)
        resolve_path = export_dir / RESOLVE_PROJECT_NAME
        if _attempt_resolve_drp_export(
            timeline,
            resolve_path,
            adapter_name=adapter_name,
            otio=otio,
            log=log,
        ):
            primary_filename = resolve_path.name
            fallback_reason = f"Native Resolve DRP generated via {adapter_name}"
            log.info("Resolve DRP generated; writing fallback copy", adapter=adapter_name)
        else:
            fallback_reason = f"Resolve adapter {adapter_name} failed; fallback only"
            log.warning("Resolve DRP export failed; retaining fallback", adapter=adapter_name)
    else:
        log.warning(
            "Resolve adapter unavailable; exporting Resolve-compatible FCPXML",
            clip_id=clip.clip_id,
        )

    fallback_path = export_dir / RESOLVE_FCPXML_NAME
    save_text_file(fallback_path, _annotate_fallback_xml(universal_xml, reason=fallback_reason))

    if primary_filename == fallback_path.name:
        log.warning("Resolve DRP export unavailable; using FCPXML fallback", reason=fallback_reason)
    return primary_filename, fallback_path.name


def _write_project_files(
    timeline,  # type: ignore[no-untyped-def]
    export_dir: Path,
    *,
    clip: LibraryClip,
    final_media_relative_path: Path,
    subtitle_cues: list[SubtitleCue],
    duration_seconds: float,
    fps: float,
    otio: ModuleType,
    log: CompatibilityLog,
) -> Dict[str, str]:
    files: Dict[str, str] = {}

    available_adapters, adapter_lookup = _available_adapter_names(otio)
    fcp_xml_adapter = _load_fcp_xml_adapter()

    universal_path = export_dir / UNIVERSAL_XML_NAME
    universal_xml = fcp_xml_adapter.write_to_string(timeline)
    save_text_file(universal_path, universal_xml)
    files["universal"] = UNIVERSAL_XML_NAME
    log.info("Wrote universal FCPXML", path=str(universal_path))

    final_cut_path = export_dir / FINALCUT_PROJECT_NAME
    save_text_file(final_cut_path, universal_xml)
    files["final_cut"] = FINALCUT_PROJECT_NAME
    log.info("Wrote Final Cut Pro project", path=str(final_cut_path))

    resolve_primary, resolve_fallback = _write_resolve_project(
        timeline,
        export_dir,
        universal_xml=universal_xml,
        available_adapters=available_adapters,
        adapter_lookup=adapter_lookup,
        otio=otio,
        clip=clip,
        log=log,
    )
    files["resolve"] = resolve_primary
    files["resolve_fallback"] = resolve_fallback

    premiere_path = export_dir / PREMIERE_PROJECT_NAME
    premiere_xml = generate_premiere_project(
        clip_name=clip.title,
        clip_duration_seconds=duration_seconds,
        clip_relative_path=final_media_relative_path.as_posix(),
        subtitles=build_srt_entries(subtitle_cues),
        fps=fps,
    )
    save_text_file(premiere_path, premiere_xml)
    files["premiere"] = PREMIERE_PROJECT_NAME
    log.info("Wrote Premiere Pro project", path=str(premiere_path))

    if not _is_supported_project_extension(files["resolve"], available_adapters):
        log.warning(
            "Resolve project extension unsupported; defaulting to universal",
            filename=files["resolve"],
            adapters=sorted(available_adapters),
        )
        files["resolve"] = files["resolve_fallback"]

    return files


def _write_manifest(
    export_dir: Path,
    clip: LibraryClip,
    media_paths: Dict[str, Path | None],
    project_files: Dict[str, str],
    transform_metadata: Dict[str, object],
    *,
    layers: list[str],
    effects: list[Dict[str, object]],
    log_filename: str,
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
        "timeline": {"layers": layers, "effects": effects},
        "logs": {"compatibility": log_filename},
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

    compat_log = CompatibilityLog()

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
    compat_log.info("Copied source media", path=str(copied_raw))
    copied_vertical = _copy_media(vertical_clip_path, media_dir)
    compat_log.info("Copied final short media", path=str(copied_vertical))
    copied_subtitles: Path | None = None
    if subtitle_path.exists():
        copied_subtitles = _copy_media(subtitle_path, media_dir)
        compat_log.info("Copied subtitle track", path=str(copied_subtitles))
    
    video_metadata = probe_video_stream(copied_raw)
    subtitle_cues = parse_srt_file(subtitle_path) if subtitle_path.exists() else []

    transform_metadata = _probe_transform_metadata(video_metadata)
    effects_summary = _summarise_effects(clip, subtitle_cues, transform_metadata, compat_log)

    timeline, timeline_duration, fps = _build_timeline(
        clip,
        copied_raw.relative_to(export_folder),
        copied_vertical.relative_to(export_folder),
        subtitle_cues,
        transform_metadata,
        video_metadata,
        otio=otio,
        log=compat_log,
        effects_summary=effects_summary,
    )

    project_files = _write_project_files(
        timeline,
        export_folder,
        clip=clip,
        final_media_relative_path=copied_vertical.relative_to(export_folder),
        subtitle_cues=subtitle_cues,
        duration_seconds=timeline_duration,
        fps=fps,
        otio=otio,
        log=compat_log,
    )

    media_manifest = {
        "raw": copied_raw.relative_to(export_folder),
        "vertical": copied_vertical.relative_to(export_folder),
        "subtitles": copied_subtitles.relative_to(export_folder) if copied_subtitles else None,
    }
    log_filename = EXPORT_LOG_NAME
    _write_manifest(
        export_folder,
        clip,
        media_manifest,
        project_files,
        transform_metadata,
        layers=timeline.metadata.get("atropos", {}).get("layers", []),
        effects=effects_summary,
        log_filename=log_filename,
    )
    compat_log.write(export_folder / log_filename)

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
