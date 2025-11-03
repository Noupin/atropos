"""Clip library discovery and metadata utilities."""
from __future__ import annotations

import asyncio
import base64
import json
import logging
import math
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional
from urllib.parse import parse_qs, urlencode, urlparse, urlunparse

from fastapi import HTTPException, status

from schedule_upload import get_out_root
from helpers.media import probe_media_duration

LOGGER = logging.getLogger(__name__)
DEFAULT_ACCOUNT_PLACEHOLDER = "__default__"
ADJUSTMENT_METADATA_SUFFIX = ".adjust.json"

CLIP_FILENAME_PATTERN = re.compile(r"^clip_(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)(?:_r(\d+(?:\.\d+)?))?$")
FULL_VIDEO_PATTERN = re.compile(r"^full video:\s*(https?://\S+)", re.IGNORECASE)
CREDIT_PATTERN = re.compile(r"^credit:\s*(.+)$", re.IGNORECASE)
DATE_SUFFIX_PATTERN = re.compile(r"_(\d{8})$")
TIME_COMPONENT_PATTERN = re.compile(
    r"^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)(?:s)?)?$", re.IGNORECASE
)
CANDIDATE_MANIFEST_FILES = [
    "render_queue.json",
    "candidates.json",
    "candidates_top.json",
    "candidates_all.json",
]


@dataclass
class CandidateMetadata:
    quote: Optional[str]
    reason: Optional[str]
    rating: Optional[float]


@dataclass
class DescriptionMetadata:
    description: str
    source_url: Optional[str]
    timestamp_url: Optional[str]
    timestamp_seconds: Optional[float]
    channel: Optional[str]


@dataclass
class ProjectMetadata:
    title: str
    published_at: Optional[str]
    source_duration_seconds: Optional[float] = None


@dataclass
class AdjustmentMetadata:
    start_seconds: float
    end_seconds: float
    original_start_seconds: Optional[float]
    original_end_seconds: Optional[float]
    layout_id: Optional[str]


@dataclass
class LibraryClip:
    clip_id: str
    title: str
    channel: str
    created_at: datetime
    duration_seconds: float
    source_duration_seconds: Optional[float]
    description: str
    source_url: str
    source_title: str
    source_published_at: Optional[str]
    video_id: str
    video_title: str
    rating: Optional[float]
    quote: Optional[str]
    reason: Optional[str]
    account_id: Optional[str]
    timestamp_url: Optional[str]
    timestamp_seconds: Optional[float]
    thumbnail_url: Optional[str]
    playback_path: Path
    start_seconds: float
    end_seconds: float
    original_start_seconds: float
    original_end_seconds: float
    has_adjustments: bool
    layout_id: Optional[str]

    def to_payload(self, request) -> Dict[str, object]:  # type: ignore[override]
        from fastapi import Request  # local import to avoid circular for typing

        if not isinstance(request, Request):  # pragma: no cover - defensive
            raise TypeError("Expected FastAPI Request when serialising clip payload")

        playback_url = request.url_for(
            "get_account_clip_video",
            account_id=self.account_id or DEFAULT_ACCOUNT_PLACEHOLDER,
            clip_id=self.clip_id,
        )
        preview_url = request.url_for(
            "get_account_clip_preview",
            account_id=self.account_id or DEFAULT_ACCOUNT_PLACEHOLDER,
            clip_id=self.clip_id,
        )
        thumbnail_url = request.url_for(
            "get_account_clip_thumbnail",
            account_id=self.account_id or DEFAULT_ACCOUNT_PLACEHOLDER,
            clip_id=self.clip_id,
        )

        return {
            "id": self.clip_id,
            "title": self.title,
            "channel": self.channel,
            "created_at": self.created_at,
            "duration_seconds": self.duration_seconds,
            "source_duration_seconds": self.source_duration_seconds,
            "description": self.description,
            "playback_url": str(playback_url),
            "preview_url": str(preview_url),
            "source_url": self.source_url,
            "source_title": self.source_title,
            "source_published_at": self.source_published_at,
            "video_id": self.video_id,
            "video_title": self.video_title,
            "views": None,
            "rating": self.rating,
            "quote": self.quote,
            "reason": self.reason,
            "account": self.account_id,
            "timestamp_url": self.timestamp_url,
            "timestamp_seconds": self.timestamp_seconds,
            "thumbnail_url": str(thumbnail_url),
            "layout_id": self.layout_id,
            "start_seconds": self.start_seconds,
            "end_seconds": self.end_seconds,
            "original_start_seconds": self.original_start_seconds,
            "original_end_seconds": self.original_end_seconds,
            "has_adjustments": self.has_adjustments,
        }


def _round_two(value: float) -> float:
    return round(value * 100) / 100


def _format_candidate_key(start: float, end: float) -> str:
    return f"{_round_two(start):.2f}-{_round_two(end):.2f}"


def load_adjustment_metadata(clip_path: Path) -> Optional[AdjustmentMetadata]:
    meta_path = clip_path.with_suffix(ADJUSTMENT_METADATA_SUFFIX)
    if not meta_path.exists() or not meta_path.is_file():
        return None
    try:
        raw = json.loads(meta_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    start = raw.get("start_seconds")
    end = raw.get("end_seconds")
    if not isinstance(start, (int, float)) or not isinstance(end, (int, float)):
        return None
    original_start = raw.get("original_start_seconds")
    original_end = raw.get("original_end_seconds")
    start_value = float(start)
    end_value = float(end)
    original_start_value = (
        float(original_start)
        if isinstance(original_start, (int, float)) and math.isfinite(float(original_start))
        else None
    )
    original_end_value = (
        float(original_end)
        if isinstance(original_end, (int, float)) and math.isfinite(float(original_end))
        else None
    )
    raw_layout = raw.get("layout_id")
    layout_id = str(raw_layout).strip() if isinstance(raw_layout, str) and raw_layout.strip() else None

    return AdjustmentMetadata(
        start_seconds=start_value,
        end_seconds=end_value,
        original_start_seconds=original_start_value,
        original_end_seconds=original_end_value,
        layout_id=layout_id,
    )


def write_adjustment_metadata(
    clip_path: Path,
    *,
    start_seconds: float,
    end_seconds: float,
    original_start_seconds: float,
    original_end_seconds: float,
    layout_id: Optional[str] = None,
) -> None:
    meta_path = clip_path.with_suffix(ADJUSTMENT_METADATA_SUFFIX)
    payload = {
        "start_seconds": float(start_seconds),
        "end_seconds": float(end_seconds),
        "original_start_seconds": float(original_start_seconds),
        "original_end_seconds": float(original_end_seconds),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    if layout_id:
        payload["layout_id"] = layout_id
    meta_path.write_text(json.dumps(payload, indent=2, sort_keys=True), encoding="utf-8")


def _parse_clip_filename(stem: str) -> Optional[tuple[float, float, Optional[float]]]:
    match = CLIP_FILENAME_PATTERN.match(stem)
    if not match:
        return None
    start_raw, end_raw, rating_raw = match.groups()
    try:
        start = float(start_raw)
        end = float(end_raw)
    except (TypeError, ValueError):
        return None
    if math.isnan(start) or math.isnan(end):
        return None
    rating = None
    if rating_raw:
        try:
            rating = float(rating_raw)
        except ValueError:
            rating = None
    return start, end, rating


def _parse_timestamp_token(token: Optional[str]) -> Optional[float]:
    if not token:
        return None
    value = token.strip().lower()
    if not value:
        return None
    if value.isdigit():
        return float(value)
    match = TIME_COMPONENT_PATTERN.match(value)
    if match:
        hours_raw, minutes_raw, seconds_raw = match.groups()
        hours = int(hours_raw) if hours_raw else 0
        minutes = int(minutes_raw) if minutes_raw else 0
        seconds = int(seconds_raw) if seconds_raw else 0
        return float(hours * 3600 + minutes * 60 + seconds)
    digits = re.findall(r"\d+", value)
    if digits:
        try:
            return float(digits[0])
        except ValueError:
            return None
    return None


def _parse_timestamp_from_url(raw_url: str) -> Optional[float]:
    try:
        parsed = urlparse(raw_url)
    except ValueError:
        return None
    query = parse_qs(parsed.query)
    token = None
    for key in ("t", "start"):
        if key in query and query[key]:
            token = query[key][0]
            break
    if not token and parsed.fragment:
        frag_query = parse_qs(parsed.fragment)
        if "t" in frag_query and frag_query["t"]:
            token = frag_query["t"][0]
    return _parse_timestamp_token(token)


def _parse_description_metadata(text: str) -> DescriptionMetadata:
    timestamp_url: Optional[str] = None
    channel: Optional[str] = None
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        full_match = FULL_VIDEO_PATTERN.search(line)
        if full_match:
            candidate = (full_match.group(1) or "").strip()
            if candidate:
                timestamp_url = candidate
        credit_match = CREDIT_PATTERN.search(line)
        if credit_match and channel is None:
            candidate = (credit_match.group(1) or "").strip()
            if candidate:
                channel = candidate
    source_url: Optional[str] = None
    if timestamp_url:
        try:
            parsed = urlparse(timestamp_url)
            query = parse_qs(parsed.query)
            query.pop("t", None)
            query.pop("start", None)
            cleaned = parsed._replace(query=urlencode(query, doseq=True), fragment="")
            source_url = urlunparse(cleaned)
            if source_url.endswith("?"):
                source_url = source_url[:-1]
        except ValueError:
            source_url = timestamp_url
    timestamp_seconds = _parse_timestamp_from_url(timestamp_url) if timestamp_url else None
    return DescriptionMetadata(
        description=text,
        source_url=source_url,
        timestamp_url=timestamp_url,
        timestamp_seconds=timestamp_seconds,
        channel=channel,
    )


def _parse_date_token(token: str) -> Optional[str]:
    if len(token) != 8 or not token.isdigit():
        return None
    year = int(token[:4])
    month = int(token[4:6])
    day = int(token[6:8])
    try:
        iso = datetime(year, month, day, tzinfo=timezone.utc).isoformat()
        return iso
    except ValueError:
        return None


def _infer_project_metadata(project_name: str) -> ProjectMetadata:
    title_source = project_name
    published_at: Optional[str] = None
    match = DATE_SUFFIX_PATTERN.search(project_name)
    if match:
        token = match.group(1) or ""
        iso = _parse_date_token(token)
        if iso:
            published_at = iso
            title_source = project_name[: -(len(token) + 1)]
    normalised = re.sub(r"[_-]+", " ", title_source).strip()
    title = normalised or project_name
    return ProjectMetadata(title=title, published_at=published_at)


def _load_project_metadata(project_dir: Path) -> ProjectMetadata:
    info = _infer_project_metadata(project_dir.name)
    video_path = project_dir / f"{project_dir.name}.mp4"
    try:
        exists = video_path.exists()
    except OSError:
        exists = False
    if exists:
        duration = probe_media_duration(video_path)
        if duration is not None and math.isfinite(duration) and duration > 0:
            info.source_duration_seconds = float(duration)
    return info


def _load_candidate_metadata(project_dir: Path) -> Dict[str, CandidateMetadata]:
    metadata: Dict[str, CandidateMetadata] = {}
    for manifest_name in CANDIDATE_MANIFEST_FILES:
        manifest_path = project_dir / manifest_name
        if not manifest_path.exists():
            continue
        try:
            raw = json.loads(manifest_path.read_text())
        except Exception:  # pragma: no cover - invalid JSON
            continue
        if isinstance(raw, dict):
            # Some manifests wrap candidates in a dictionary
            if "candidates" in raw and isinstance(raw["candidates"], list):
                entries = raw["candidates"]
            elif "clips" in raw and isinstance(raw["clips"], list):
                entries = raw["clips"]
            else:
                continue
        elif isinstance(raw, list):
            entries = raw
        else:
            continue
        for entry in entries:
            if not isinstance(entry, dict):
                continue
            start = entry.get("start")
            end = entry.get("end")
            if not isinstance(start, (int, float)) or not isinstance(end, (int, float)):
                continue
            key = _format_candidate_key(float(start), float(end))
            quote = entry.get("quote")
            quote_value = quote.strip() if isinstance(quote, str) and quote.strip() else None
            reason = entry.get("reason")
            reason_value = reason.strip() if isinstance(reason, str) and reason.strip() else None
            rating_raw = entry.get("rating")
            rating_value: Optional[float]
            if isinstance(rating_raw, (int, float)):
                rating_value = float(rating_raw)
            else:
                rating_value = None
            existing = metadata.get(key)
            if existing is None:
                metadata[key] = CandidateMetadata(
                    quote=quote_value, reason=reason_value, rating=rating_value
                )
            else:
                if existing.quote is None and quote_value:
                    existing.quote = quote_value
                if existing.reason is None and reason_value:
                    existing.reason = reason_value
                if existing.rating is None and rating_value is not None:
                    existing.rating = rating_value
    return metadata


def _find_project_directories(root_dir: Path) -> List[Path]:
    queue: List[Path] = [root_dir]
    visited = {root_dir}
    projects: List[Path] = []
    while queue:
        current = queue.pop()
        try:
            entries = list(current.iterdir())
        except OSError:
            continue
        has_shorts = False
        for entry in entries:
            if entry.name == "shorts" and entry.is_dir():
                has_shorts = True
                break
        if has_shorts:
            projects.append(current)
            continue
        for entry in entries:
            if entry in visited:
                continue
            visited.add(entry)
            if entry.is_dir():
                queue.append(entry)
    return projects


def _encode_clip_id(relative_path: Path) -> str:
    normalised = relative_path.as_posix()
    token = base64.urlsafe_b64encode(normalised.encode("utf-8")).decode("ascii")
    return token.rstrip("=")


def _decode_clip_id(token: str) -> Path:
    padding = "=" * (-len(token) % 4)
    raw = base64.urlsafe_b64decode(token + padding).decode("utf-8")
    return Path(raw)


def _read_description_file(candidates: List[Path]) -> str:
    for candidate in candidates:
        try:
            content = candidate.read_text(encoding="utf-8").strip()
        except OSError:
            continue
        if content:
            return content
    return ""


def _build_clip(
    clip_path: Path,
    project_dir: Path,
    project_info: ProjectMetadata,
    candidate_map: Dict[str, CandidateMetadata],
    account_id: Optional[str],
    base: Path,
) -> Optional[LibraryClip]:
    stem = clip_path.stem
    parsed = _parse_clip_filename(stem)
    start: Optional[float]
    end: Optional[float]
    rating: Optional[float]
    candidate: Optional[CandidateMetadata]
    original_start: Optional[float]
    original_end: Optional[float]
    if parsed:
        start, end, rating = parsed
        key = _format_candidate_key(start, end)
        candidate = candidate_map.get(key)
        original_start = start
        original_end = end
    else:
        start = end = rating = None
        candidate = None
        original_start = None
        original_end = None

    layout_id: Optional[str] = None
    adjustments = load_adjustment_metadata(clip_path)
    if adjustments:
        start = adjustments.start_seconds
        end = adjustments.end_seconds
        if adjustments.original_start_seconds is not None:
            original_start = adjustments.original_start_seconds
        if adjustments.original_end_seconds is not None:
            original_end = adjustments.original_end_seconds
        layout_id = adjustments.layout_id or layout_id
    description_text = _read_description_file(
        [
            clip_path.with_suffix(".txt"),
            clip_path.with_suffix(".md"),
            clip_path.parent / "description.txt",
            clip_path.parent / "description.md",
        ]
    )
    description_metadata = _parse_description_metadata(description_text)
    try:
        stats = clip_path.stat()
    except OSError:
        return None
    duration = max(0.0, end - start) if start is not None and end is not None else 0.0
    start_value = float(start) if start is not None else 0.0
    end_value = float(end) if end is not None else max(0.0, duration)
    if original_start is not None:
        original_start_value = float(original_start)
    else:
        original_start_value = start_value
    if original_end is not None:
        original_end_value = float(original_end)
    else:
        original_end_value = end_value
    has_adjustments = (
        start is not None
        and end is not None
        and original_start is not None
        and original_end is not None
        and not (
            math.isclose(start, original_start, abs_tol=1e-3)
            and math.isclose(end, original_end, abs_tol=1e-3)
        )
    )
    project_title = project_info.title or project_dir.name
    title = candidate.quote or project_title or stem
    timestamp_url = description_metadata.timestamp_url
    if (
        not timestamp_url
        and description_metadata.source_url
        and start is not None
        and math.isfinite(start)
    ):
        try:
            parsed_url = urlparse(description_metadata.source_url)
            query = parse_qs(parsed_url.query)
            query["t"] = [str(int(round(start)))]
            timestamp_url = urlunparse(
                parsed_url._replace(query=urlencode(query, doseq=True))
            )
        except ValueError:
            timestamp_url = None
    timestamp_seconds = (
        description_metadata.timestamp_seconds
        if description_metadata.timestamp_seconds is not None
        else (start if start is not None and math.isfinite(start) else None)
    )
    if (
        project_info.source_duration_seconds is not None
        and math.isfinite(project_info.source_duration_seconds)
        and project_info.source_duration_seconds >= 0
    ):
        source_duration_value = float(project_info.source_duration_seconds)
    else:
        source_duration_value = None
    relative_path = clip_path.relative_to(base)
    clip_id = _encode_clip_id(relative_path)
    project_relative = project_dir.relative_to(base)
    video_id = _encode_clip_id(project_relative)
    created_at = datetime.fromtimestamp(stats.st_mtime, tz=timezone.utc)
    return LibraryClip(
        clip_id=clip_id,
        title=title,
        channel=description_metadata.channel or "Unknown channel",
        created_at=created_at,
        duration_seconds=duration,
        source_duration_seconds=source_duration_value,
        description=description_text,
        source_url=description_metadata.source_url
        or description_metadata.timestamp_url
        or "",
        source_title=project_title,
        source_published_at=project_info.published_at,
        video_id=video_id,
        video_title=project_title,
        rating=candidate.rating if candidate else rating,
        quote=candidate.quote if candidate else None,
        reason=candidate.reason if candidate else None,
        account_id=account_id,
        timestamp_url=timestamp_url,
        timestamp_seconds=timestamp_seconds,
        thumbnail_url=None,
        playback_path=clip_path,
        start_seconds=start_value,
        end_seconds=end_value,
        original_start_seconds=original_start_value,
        original_end_seconds=original_end_value,
        has_adjustments=has_adjustments,
        layout_id=layout_id,
    )


def list_account_clips_sync(account_id: Optional[str]) -> List[LibraryClip]:
    base = get_out_root()
    account_dir = base / account_id if account_id else base
    if not account_dir.exists() or not account_dir.is_dir():
        return []
    projects = _find_project_directories(account_dir)
    clips: List[LibraryClip] = []
    for project_dir in projects:
        project_info = _load_project_metadata(project_dir)
        candidate_map = _load_candidate_metadata(project_dir)
        shorts_dir = project_dir / "shorts"
        try:
            short_files = list(shorts_dir.iterdir())
        except OSError:
            continue
        for file_path in short_files:
            if file_path.suffix.lower() != ".mp4":
                continue
            clip = _build_clip(file_path, project_dir, project_info, candidate_map, account_id, base)
            if clip is not None:
                clips.append(clip)
    clips.sort(key=lambda clip: clip.created_at, reverse=True)
    return clips


_CURSOR_VERSION = 1
_MAX_PAGE_SIZE = 100


def _summarize_projects(clips: List[LibraryClip]) -> list[dict[str, object]]:
    """Return summary metadata for grouping clips by project/video."""

    summaries: Dict[str, dict[str, object]] = {}
    for clip in clips:
        key = clip.video_id or clip.clip_id
        title = clip.video_title or clip.source_title or clip.title
        created_at = clip.created_at.isoformat()
        if key not in summaries:
            summaries[key] = {
                "title": title,
                "total_clips": 1,
                "latest_created_at": created_at,
            }
            continue

        entry = summaries[key]
        entry["total_clips"] = int(entry.get("total_clips", 0)) + 1
        if created_at > entry.get("latest_created_at", ""):
            entry["latest_created_at"] = created_at

    results = [
        {
            "id": key,
            "title": value.get("title", key),
            "total_clips": int(value.get("total_clips", 0)),
            "latest_created_at": value.get("latest_created_at", ""),
        }
        for key, value in summaries.items()
    ]
    results.sort(key=lambda item: item["latest_created_at"], reverse=True)
    return results


def _encode_cursor(offset: int) -> str:
    payload = {"v": _CURSOR_VERSION, "o": int(offset)}
    raw = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    token = base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")
    return token


def _decode_cursor(value: Optional[str]) -> int:
    if not value:
        return 0
    padding = "=" * (-len(value) % 4)
    try:
        decoded = base64.urlsafe_b64decode((value + padding).encode("ascii"))
        payload = json.loads(decoded.decode("utf-8"))
    except (ValueError, json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise ValueError("Invalid pagination cursor") from exc

    if not isinstance(payload, dict):
        raise ValueError("Invalid pagination cursor")

    version = payload.get("v")
    offset = payload.get("o")
    if version != _CURSOR_VERSION or not isinstance(offset, int) or offset < 0:
        raise ValueError("Invalid pagination cursor")
    return offset


def paginate_account_clips_sync(
    account_id: Optional[str],
    *,
    limit: int,
    cursor: Optional[str],
) -> tuple[list[LibraryClip], Optional[str], int, list[dict[str, object]]]:
    try:
        offset = _decode_cursor(cursor)
    except ValueError as exc:  # pragma: no cover - validated by endpoint tests
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    size = max(1, min(int(limit), _MAX_PAGE_SIZE))
    clips = list_account_clips_sync(account_id)
    project_summaries = _summarize_projects(clips)

    if offset >= len(clips):
        return [], None, len(clips), project_summaries

    end_index = min(offset + size, len(clips))
    page = clips[offset:end_index]
    next_cursor = _encode_cursor(end_index) if end_index < len(clips) else None
    return page, next_cursor, len(clips), project_summaries


def paginate_account_clips(
    account_id: Optional[str],
    *,
    limit: int,
    cursor: Optional[str],
) -> asyncio.Future[tuple[list[LibraryClip], Optional[str], int, list[dict[str, object]]]]:
    return asyncio.to_thread(
        paginate_account_clips_sync,
        account_id,
        limit=limit,
        cursor=cursor,
    )


def list_account_clips(account_id: Optional[str]) -> asyncio.Future[List[LibraryClip]]:
    return asyncio.to_thread(list_account_clips_sync, account_id)


def resolve_clip_video_path(account_id: Optional[str], clip_id: str) -> Path:
    base = get_out_root()
    target_account = base / account_id if account_id else base
    relative = _decode_clip_id(clip_id)
    clip_path = base / relative
    try:
        clip_path.relative_to(target_account)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Clip not found") from exc
    if not clip_path.exists() or not clip_path.is_file():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Clip not found")
    return clip_path


__all__ = [
    "LibraryClip",
    "DEFAULT_ACCOUNT_PLACEHOLDER",
    "ADJUSTMENT_METADATA_SUFFIX",
    "list_account_clips",
    "list_account_clips_sync",
    "paginate_account_clips",
    "paginate_account_clips_sync",
    "resolve_clip_video_path",
    "load_adjustment_metadata",
    "write_adjustment_metadata",
]
