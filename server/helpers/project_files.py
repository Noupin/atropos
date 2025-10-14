"""Utilities for generating editor project files for rendered clips."""

from __future__ import annotations

from dataclasses import dataclass
from fractions import Fraction
from pathlib import Path
from typing import Callable, Dict
from uuid import uuid4
import html

from config import OUTPUT_FPS


FRAME_WIDTH = 1080
FRAME_HEIGHT = 1920


@dataclass(frozen=True)
class ProjectContext:
    """Snapshot of clip metadata needed for project file generation."""

    title: str
    video_path: Path
    duration_seconds: float
    frame_rate: float = OUTPUT_FPS


@dataclass(frozen=True)
class ProjectFileSpec:
    """Describes how to render a project file for a specific editor."""

    key: str
    suffix: str
    generator: Callable[[ProjectContext], str]


@dataclass(frozen=True)
class ProjectFileDetails:
    """Details about a generated project file on disk."""

    path: Path
    filename: str


def _clamp_duration_seconds(duration: float) -> float:
    if duration <= 0:
        return 1 / OUTPUT_FPS
    return duration


def _duration_frames(duration: float, frame_rate: float) -> int:
    frames = round(_clamp_duration_seconds(duration) * frame_rate)
    return max(1, int(frames))


def _format_fraction(frames: int, frame_rate: float) -> str:
    fraction = Fraction(frames, int(round(frame_rate)))
    return f"{fraction.numerator}/{fraction.denominator}s"


def _escape(value: str) -> str:
    return html.escape(value, quote=True)


def _normalise_title(context: ProjectContext) -> str:
    title = context.title.strip()
    if not title:
        return context.video_path.stem
    return title


def _generate_premiere_xml(context: ProjectContext) -> str:
    """Return an XMEML project referencing the rendered clip for Premiere Pro."""

    frames = _duration_frames(context.duration_seconds, context.frame_rate)
    timebase = int(round(context.frame_rate))
    ntsc = "TRUE" if abs(context.frame_rate - round(context.frame_rate)) > 1e-6 else "FALSE"
    title = _escape(_normalise_title(context))
    clip_name = _escape(context.video_path.name)
    path_url = _escape(context.video_path.name)

    return (
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n"
        "<!DOCTYPE xmeml>\n"
        "<xmeml version=\"5\">\n"
        "  <sequence id=\"sequence-1\">\n"
        f"    <name>{title}</name>\n"
        f"    <duration>{frames}</duration>\n"
        "    <rate>\n"
        f"      <timebase>{timebase}</timebase>\n"
        f"      <ntsc>{ntsc}</ntsc>\n"
        "    </rate>\n"
        "    <media>\n"
        "      <video>\n"
        "        <format>\n"
        "          <samplecharacteristics>\n"
        f"            <width>{FRAME_WIDTH}</width>\n"
        f"            <height>{FRAME_HEIGHT}</height>\n"
        "            <pixelaspectratio>1</pixelaspectratio>\n"
        "            <rate>\n"
        f"              <timebase>{timebase}</timebase>\n"
        f"              <ntsc>{ntsc}</ntsc>\n"
        "            </rate>\n"
        "          </samplecharacteristics>\n"
        "        </format>\n"
        "        <track>\n"
        "          <clipitem id=\"clipitem-1\">\n"
        f"            <name>{title}</name>\n"
        "            <enabled>TRUE</enabled>\n"
        "            <start>0</start>\n"
        f"            <end>{frames}</end>\n"
        "            <in>0</in>\n"
        f"            <out>{frames}</out>\n"
        "            <file id=\"file-1\">\n"
        f"              <name>{clip_name}</name>\n"
        f"              <pathurl>{path_url}</pathurl>\n"
        "              <rate>\n"
        f"                <timebase>{timebase}</timebase>\n"
        f"                <ntsc>{ntsc}</ntsc>\n"
        "              </rate>\n"
        f"              <duration>{frames}</duration>\n"
        "              <media>\n"
        "                <video/>\n"
        "                <audio>\n"
        "                  <channelcount>2</channelcount>\n"
        "                </audio>\n"
        "              </media>\n"
        "            </file>\n"
        "            <link>\n"
        "              <linkclipref>clipitem-1</linkclipref>\n"
        "              <mediatype>video</mediatype>\n"
        "              <trackindex>1</trackindex>\n"
        "              <clipindex>1</clipindex>\n"
        "            </link>\n"
        "          </clipitem>\n"
        "        </track>\n"
        "      </video>\n"
        "      <audio>\n"
        "        <track>\n"
        "          <clipitem id=\"audio-1\">\n"
        f"            <name>{title}</name>\n"
        "            <enabled>TRUE</enabled>\n"
        "            <start>0</start>\n"
        f"            <end>{frames}</end>\n"
        "            <in>0</in>\n"
        f"            <out>{frames}</out>\n"
        "            <file id=\"file-1\"/>\n"
        "            <sourcetrack>\n"
        "              <mediatype>audio</mediatype>\n"
        "              <trackindex>1</trackindex>\n"
        "            </sourcetrack>\n"
        "            <link>\n"
        "              <linkclipref>clipitem-1</linkclipref>\n"
        "              <mediatype>audio</mediatype>\n"
        "              <trackindex>1</trackindex>\n"
        "              <clipindex>1</clipindex>\n"
        "            </link>\n"
        "          </clipitem>\n"
        "        </track>\n"
        "      </audio>\n"
        "    </media>\n"
        "  </sequence>\n"
        "</xmeml>\n"
    )


def _generate_fcpxml(context: ProjectContext, version: str = "1.9") -> str:
    """Return an FCPXML document referencing the rendered clip."""

    frames = _duration_frames(context.duration_seconds, context.frame_rate)
    duration = _format_fraction(frames, context.frame_rate)
    frame_duration = _format_fraction(1, context.frame_rate)
    title = _escape(_normalise_title(context))
    clip_name = _escape(context.video_path.name)
    asset_src = _escape(context.video_path.name)
    asset_id = f"r{uuid4().hex[:8]}"

    return (
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n"
        f"<fcpxml version=\"{version}\">\n"
        "  <resources>\n"
        f"    <format id=\"r1\" frameDuration=\"{frame_duration}\" width=\"{FRAME_WIDTH}\" height=\"{FRAME_HEIGHT}\" colorSpace=\"Rec.709\"/>\n"
        f"    <asset id=\"{asset_id}\" name=\"{clip_name}\" uid=\"urn:uuid:{uuid4()}\" start=\"0s\" duration=\"{duration}\" hasVideo=\"1\" hasAudio=\"1\" audioChannels=\"2\" audioRate=\"48000\" format=\"r1\" src=\"{asset_src}\"/>\n"
        "  </resources>\n"
        "  <library>\n"
        f"    <event name=\"{title}\">\n"
        f"      <project name=\"{title}\">\n"
        f"        <sequence duration=\"{duration}\" format=\"r1\" tcStart=\"0s\" tcFormat=\"NDF\">\n"
        "          <spine>\n"
        f"            <asset-clip ref=\"{asset_id}\" name=\"{title}\" start=\"0s\" offset=\"0s\" duration=\"{duration}\"/>\n"
        "          </spine>\n"
        "        </sequence>\n"
        "      </project>\n"
        "    </event>\n"
        "  </library>\n"
        "</fcpxml>\n"
    )


PROJECT_FILE_SPECS: Dict[str, ProjectFileSpec] = {
    "premiere": ProjectFileSpec(
        key="premiere",
        suffix=".premiere.xml",
        generator=_generate_premiere_xml,
    ),
    "resolve": ProjectFileSpec(
        key="resolve",
        suffix=".resolve.fcpxml",
        generator=lambda context: _generate_fcpxml(context, version="1.9"),
    ),
    "final_cut": ProjectFileSpec(
        key="final_cut",
        suffix=".finalcut.fcpxml",
        generator=lambda context: _generate_fcpxml(context, version="1.9"),
    ),
}


PROJECT_FILE_SUFFIXES: Dict[str, str] = {
    key: spec.suffix for key, spec in PROJECT_FILE_SPECS.items()
}


def _build_target_path(video_path: Path, suffix: str) -> Path:
    """Return the on-disk location for a project file next to ``video_path``."""

    # ``with_name`` avoids retaining the original suffix when the rendered short is
    # multi-suffixed (e.g. ``.clip.mp4``) while keeping the file in the same
    # directory as the rendered video.
    return video_path.with_name(f"{video_path.stem}{suffix}")


def ensure_project_file(
    target: str,
    *,
    title: str,
    video_path: Path,
    duration_seconds: float,
) -> ProjectFileDetails:
    """Render (or re-render) a project file for ``target`` and return its details."""

    spec = PROJECT_FILE_SPECS.get(target)
    if spec is None:
        raise KeyError(f"Unsupported project file target: {target}")

    context = ProjectContext(title=title, video_path=video_path, duration_seconds=duration_seconds)
    target_path = _build_target_path(video_path, spec.suffix)
    target_path.parent.mkdir(parents=True, exist_ok=True)
    xml_content = spec.generator(context)
    target_path.write_text(xml_content, encoding="utf-8")
    return ProjectFileDetails(path=target_path, filename=target_path.name)


def generate_project_files(
    *,
    title: str,
    video_path: Path,
    duration_seconds: float,
    output_dir: Path,
) -> Dict[str, ProjectFileDetails]:
    """Generate editor project files for ``video_path`` and return their locations."""

    results: Dict[str, ProjectFileDetails] = {}
    for key in PROJECT_FILE_SPECS:
        details = ensure_project_file(
            key,
            title=title,
            video_path=video_path,
            duration_seconds=duration_seconds,
        )
        # ``ensure_project_file`` already writes next to ``video_path``; relocate the
        # file if a distinct ``output_dir`` is requested for backwards compatibility.
        if details.path.parent != output_dir:
            output_dir.mkdir(parents=True, exist_ok=True)
            relocated = output_dir / details.filename
            if details.path != relocated:
                relocated.write_text(details.path.read_text(encoding="utf-8"), encoding="utf-8")
                details = ProjectFileDetails(path=relocated, filename=details.filename)
        results[key] = details

    return results


__all__ = [
    "PROJECT_FILE_SPECS",
    "PROJECT_FILE_SUFFIXES",
    "ProjectFileDetails",
    "ensure_project_file",
    "generate_project_files",
]
