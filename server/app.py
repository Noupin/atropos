"""FastAPI application exposing the Atropos pipeline over REST and WebSockets."""

from __future__ import annotations

import asyncio
import hashlib
import logging
import math
import os
import re
import subprocess
import threading
import uuid
from dataclasses import dataclass, field, fields, is_dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List

from fastapi import (
    FastAPI,
    HTTPException,
    Query,
    Request,
    Response,
    WebSocket,
    WebSocketDisconnect,
    status,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field, field_validator, model_validator

from custom_types.ETone import Tone
from interfaces.clips import router as clips_router, register_legacy_routes as register_clip_legacy_routes
from interfaces.progress import PipelineEvent, PipelineEventType, PipelineObserver
from pipeline import GENERIC_HASHTAGS, process_video
from library import (
    DEFAULT_ACCOUNT_PLACEHOLDER,
    list_account_clips,
    list_account_clips_sync,
    resolve_clip_video_path,
    write_adjustment_metadata,
)
from steps.cut import save_clip
from steps.subtitle import build_srt_for_range
from steps.render import render_vertical_with_captions
from steps.render_layouts import get_layout
from helpers.description import maybe_append_website_link
from common.caption_utils import prepare_hashtags
from helpers.hashtags import generate_hashtag_strings
from helpers.formatting import youtube_timestamp_url
from auth.accounts import (
    AccountCreateRequest,
    AccountResponse,
    AccountUpdateRequest,
    AuthPingResponse,
    SUPPORTED_PLATFORMS,
    PlatformCreateRequest,
    PlatformUpdateRequest,
    add_platform,
    create_account,
    delete_account,
    delete_platform,
    ensure_account_available,
    list_accounts,
    ping_authentication,
    update_account,
    update_platform,
)
import config as pipeline_config
from upload_all import run as run_uploads

logger = logging.getLogger(__name__)

app = FastAPI(title="Atropos Pipeline API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(clips_router, prefix="/api")
register_clip_legacy_routes(app)


_config_all = list(getattr(pipeline_config, "__all__", []))
_CONFIG_DATACLASS_NAMES = {
    name for name in _config_all if is_dataclass(getattr(pipeline_config, name, None))
}
CONFIG_ATTRIBUTE_NAMES = [name for name in _config_all if name not in _CONFIG_DATACLASS_NAMES]
_CONFIG_ALLOWED_NAMES = set(CONFIG_ATTRIBUTE_NAMES) | _CONFIG_DATACLASS_NAMES
_CONFIG_DATACLASS_FIELD_MAP: Dict[str, tuple[str, str]] = {}
for dataclass_name in _CONFIG_DATACLASS_NAMES:
    dataclass_value = getattr(pipeline_config, dataclass_name, None)
    if dataclass_value is None:
        continue
    for field_info in fields(dataclass_value):
        constant_name = field_info.name.upper()
        if hasattr(pipeline_config, constant_name):
            _CONFIG_DATACLASS_FIELD_MAP[constant_name] = (dataclass_name, field_info.name)


_CLIP_ID_PATTERN = re.compile(r"clip_(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)", re.IGNORECASE)


def _parse_clip_bounds_from_id(clip_id: str) -> tuple[float, float] | None:
    match = _CLIP_ID_PATTERN.search(clip_id)
    if not match:
        return None
    start_raw, end_raw = match.groups()
    try:
        start_value = float(start_raw)
        end_value = float(end_raw)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(start_value) or not math.isfinite(end_value) or end_value <= start_value:
        return None
    return start_value, end_value


class RunRequest(BaseModel):
    """Payload for starting a new pipeline job."""

    url: str | None = Field(default=None)
    file_path: str | None = Field(default=None, alias="file_path")
    account: str | None = Field(default=None, max_length=128)
    tone: Tone | None = Field(default=None)
    review_mode: bool = Field(default=False)

    @field_validator("tone", mode="before")
    @classmethod
    def _parse_tone(cls, value: Any) -> Tone | None:
        if value is None or isinstance(value, Tone):
            return value
        try:
            return Tone(value)
        except ValueError as exc:  # pragma: no cover - validation branch
            raise ValueError(f"Unknown tone '{value}'") from exc

    @model_validator(mode="after")
    def _ensure_source(self) -> "RunRequest":
        provided = [
            value for value in [self.url, self.file_path] if isinstance(value, str) and value.strip()
        ]
        if len(provided) == 0:
            raise ValueError("Provide a video URL or a local file path to start processing.")
        if len(provided) > 1:
            raise ValueError("Provide either a video URL or a local file path, not both.")
        if self.url is not None:
            trimmed = self.url.strip()
            if not trimmed:
                raise ValueError("Video URL cannot be empty.")
            self.url = trimmed
        if self.file_path is not None:
            self.file_path = self.file_path.strip()
        return self


class RunResponse(BaseModel):
    """Response body returned when a job is accepted."""

    job_id: str


class JobStatus(BaseModel):
    """Current status information for a submitted job."""

    job_id: str
    finished: bool
    error: str | None = None


class ConfigEntry(BaseModel):
    """Serializable representation of a configuration value."""

    name: str
    value: Any
    type: str


class ConfigUpdateRequest(BaseModel):
    """Payload describing configuration updates to apply."""

    values: Dict[str, Any] = Field(default_factory=dict)


class UploadClipRequest(BaseModel):
    """Payload describing an upload request for a rendered clip."""

    platforms: list[str] | None = None
    delete_after_upload: bool | None = Field(default=None, alias="delete_after_upload")

    @field_validator("platforms", mode="before")
    @classmethod
    def _normalise_platforms(cls, value: Any) -> list[str] | None:
        if value is None:
            return None
        if isinstance(value, str):
            token = value.strip().lower()
            return [token] if token else []
        if isinstance(value, (list, tuple, set)):
            normalised: list[str] = []
            for item in value:
                if isinstance(item, str):
                    token = item.strip().lower()
                    if token:
                        normalised.append(token)
            return normalised
        raise ValueError("Platforms must be provided as strings.")


class UploadClipResponse(BaseModel):
    """Response returned after triggering a clip upload."""

    success: bool
    deleted: bool
    platforms: list[str]


class ClipAdjustmentRequest(BaseModel):
    """Request payload for updating clip boundaries."""

    start_seconds: float = Field(..., ge=0)
    end_seconds: float = Field(..., gt=0)

    @model_validator(mode="after")
    def _validate_range(self) -> "ClipAdjustmentRequest":
        if self.end_seconds <= self.start_seconds:
            raise ValueError("end_seconds must be greater than start_seconds")
        return self


_TRUE_STRINGS = {"true", "1", "yes", "y", "on"}
_FALSE_STRINGS = {"false", "0", "no", "n", "off"}


def _describe_config_type(value: Any) -> str:
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, int) and not isinstance(value, bool):
        return "integer"
    if isinstance(value, float):
        return "float"
    if isinstance(value, Tone):
        return "tone"
    if isinstance(value, Path):
        return "path"
    if isinstance(value, (list, tuple)):
        return "array"
    if isinstance(value, dict):
        return "object"
    if isinstance(value, str):
        return "string"
    if value is None:
        return "null"
    return value.__class__.__name__


def _serialise_config_value(value: Any) -> Any:
    if isinstance(value, Path):
        return str(value)
    if isinstance(value, Tone):
        return value.value
    if isinstance(value, tuple):
        return list(value)
    if isinstance(value, set):
        return sorted(value)
    return value


def _coerce_config_value(name: str, original: Any, raw: Any) -> Any:
    if isinstance(original, bool):
        if isinstance(raw, bool):
            return raw
        if isinstance(raw, str):
            lowered = raw.strip().lower()
            if lowered in _TRUE_STRINGS:
                return True
            if lowered in _FALSE_STRINGS:
                return False
        if isinstance(raw, (int, float)) and not isinstance(raw, bool):
            return bool(raw)
        raise ValueError(f"Configuration '{name}' requires a boolean value.")
    if isinstance(original, int) and not isinstance(original, bool):
        try:
            return int(raw)
        except (TypeError, ValueError) as exc:
            raise ValueError(f"Configuration '{name}' requires an integer value.") from exc
    if isinstance(original, float):
        try:
            return float(raw)
        except (TypeError, ValueError) as exc:
            raise ValueError(f"Configuration '{name}' requires a numeric value.") from exc
    if isinstance(original, Tone):
        if isinstance(raw, Tone):
            return raw
        try:
            return Tone(raw)
        except (ValueError, TypeError) as exc:
            raise ValueError(f"Configuration '{name}' requires a valid tone value.") from exc
    if isinstance(original, Path):
        if isinstance(raw, Path):
            return raw
        if isinstance(raw, str):
            return Path(raw)
        raise ValueError(f"Configuration '{name}' requires a filesystem path string.")
    if isinstance(original, tuple):
        if isinstance(raw, (list, tuple)):
            return tuple(raw)
        raise ValueError(f"Configuration '{name}' requires an array value.")
    if isinstance(original, list):
        if isinstance(raw, (list, tuple)):
            return list(raw)
        raise ValueError(f"Configuration '{name}' requires an array value.")
    if isinstance(original, str):
        if raw is None:
            return ""
        return str(raw)
    if original is None:
        return raw
    return raw


def _build_config_entry(name: str) -> ConfigEntry:
    value = getattr(pipeline_config, name)
    return ConfigEntry(
        name=name,
        value=_serialise_config_value(value),
        type=_describe_config_type(value),
    )


def _apply_config_update(name: str, raw_value: Any) -> None:
    if not hasattr(pipeline_config, name):
        raise ValueError(f"Unknown configuration '{name}'.")
    current_value = getattr(pipeline_config, name)
    if is_dataclass(current_value):
        if not isinstance(raw_value, dict):
            raise ValueError(f"Configuration '{name}' expects an object value.")
        for field_info in fields(current_value):
            if field_info.name not in raw_value:
                continue
            field_value = getattr(current_value, field_info.name)
            coerced = _coerce_config_value(
                f"{name}.{field_info.name}", field_value, raw_value[field_info.name]
            )
            setattr(current_value, field_info.name, coerced)
            constant_name = field_info.name.upper()
            if hasattr(pipeline_config, constant_name):
                setattr(pipeline_config, constant_name, coerced)
        return

    coerced_value = _coerce_config_value(name, current_value, raw_value)
    setattr(pipeline_config, name, coerced_value)
    mapping = _CONFIG_DATACLASS_FIELD_MAP.get(name)
    if mapping:
        dataclass_name, field_name = mapping
        dataclass_value = getattr(pipeline_config, dataclass_name, None)
        if dataclass_value is not None and is_dataclass(dataclass_value):
            setattr(dataclass_value, field_name, coerced_value)


def _parse_datetime(value: Any) -> datetime:
    """Return a timezone-aware datetime for ``value``."""

    if isinstance(value, datetime):
        return value.astimezone(timezone.utc)
    if isinstance(value, str):
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            pass
        else:
            return parsed.astimezone(timezone.utc)
    return datetime.now(timezone.utc)


def _safe_float(value: Any) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _safe_int(value: Any) -> int | None:
    try:
        if isinstance(value, bool):
            return None
        return int(value)
    except (TypeError, ValueError):
        return None


def _ensure_str(value: Any) -> str | None:
    if value is None:
        return None
    return str(value)


def _resolve_optional_path(value: str | None) -> Path | None:
    if not value:
        return None
    try:
        path = Path(value).expanduser().resolve()
    except (OSError, RuntimeError):
        return None
    return path


@dataclass
class ClipArtifact:
    """Metadata describing a rendered clip for playback and export."""

    clip_id: str
    title: str
    channel: str
    source_title: str
    source_url: str
    source_published_at: str | None
    created_at: datetime
    duration_seconds: float
    description: str
    video_path: Path
    account: str | None = None
    views: int | None = None
    rating: float | None = None
    quote: str | None = None
    reason: str | None = None
    start_seconds: float = 0.0
    end_seconds: float = 0.0
    original_start_seconds: float = 0.0
    original_end_seconds: float = 0.0
    source_duration_seconds: float | None = None


class ClipManifest(BaseModel):
    """API representation of a clip available for review."""

    id: str
    title: str
    channel: str
    created_at: datetime
    duration_seconds: float = Field(..., ge=0)
    source_duration_seconds: float | None = Field(default=None, ge=0)
    description: str
    playback_url: str
    preview_url: str
    source_url: str
    source_title: str
    source_published_at: str | None = None
    views: int | None = None
    rating: float | None = None
    quote: str | None = None
    reason: str | None = None
    account: str | None = None
    start_seconds: float = Field(..., ge=0)
    end_seconds: float = Field(..., ge=0)
    original_start_seconds: float = Field(..., ge=0)
    original_end_seconds: float = Field(..., ge=0)
    has_adjustments: bool = False


class LibraryClipManifest(ClipManifest):
    """Extended manifest for archived library clips."""

    timestamp_url: str | None = None
    timestamp_seconds: float | None = None
    thumbnail_url: str | None = None


def _clip_to_payload(clip: ClipArtifact, request: Request, job_id: str) -> Dict[str, Any]:
    """Return a serialisable payload for ``clip``."""

    has_adjustments = not (
        math.isclose(clip.start_seconds, clip.original_start_seconds, abs_tol=1e-3)
        and math.isclose(clip.end_seconds, clip.original_end_seconds, abs_tol=1e-3)
    )

    return {
        "id": clip.clip_id,
        "title": clip.title,
        "channel": clip.channel,
        "created_at": clip.created_at,
        "duration_seconds": clip.duration_seconds,
        "source_duration_seconds": clip.source_duration_seconds,
        "description": clip.description,
        "playback_url": str(
            request.url_for("get_job_clip_video", job_id=job_id, clip_id=clip.clip_id)
        ),
        "preview_url": str(
            request.url_for("get_job_clip_preview", job_id=job_id, clip_id=clip.clip_id)
        ),
        "source_url": clip.source_url,
        "source_title": clip.source_title,
        "source_published_at": clip.source_published_at,
        "views": clip.views,
        "rating": clip.rating,
        "quote": clip.quote,
        "reason": clip.reason,
        "account": clip.account,
        "start_seconds": clip.start_seconds,
        "end_seconds": clip.end_seconds,
        "original_start_seconds": clip.original_start_seconds,
        "original_end_seconds": clip.original_end_seconds,
        "has_adjustments": has_adjustments,
    }


@dataclass
class JobState:
    """Holds state shared between the worker thread and websocket clients."""

    job_id: str
    loop: asyncio.AbstractEventLoop
    history: List[Dict[str, Any]] = field(default_factory=list)
    listeners: List[asyncio.Queue[Dict[str, Any]]] = field(default_factory=list)
    lock: threading.Lock = field(default_factory=threading.Lock)
    finished: bool = False
    error: str | None = None
    thread: threading.Thread | None = None
    project_dir: Path | None = None
    clips: Dict[str, ClipArtifact] = field(default_factory=dict)
    review_mode: bool = False
    resume_event: threading.Event | None = None
    audio_path: Path | None = None
    transcript_path: Path | None = None
    subtitles_path: Path | None = None
    source_kind: str | None = None

    def publish(self, event: PipelineEvent) -> None:
        """Broadcast ``event`` to all listeners and append it to history."""

        with self.lock:
            data = dict(event.data or {})
            if event.type == PipelineEventType.PIPELINE_STARTED:
                kind_value = _ensure_str(data.get("source_kind"))
                if kind_value in {"local", "remote"}:
                    self.source_kind = kind_value
            if event.type == PipelineEventType.PIPELINE_COMPLETED:
                clip_count = len(self.clips)
                data.setdefault("clips_rendered", clip_count)
                data.setdefault("clips_available", clip_count)
                if self.source_kind:
                    data.setdefault("source_kind", self.source_kind)
                audio_path_value = _ensure_str(data.get("audio_path"))
                transcript_path_value = _ensure_str(data.get("transcript_path"))
                subtitles_path_value = _ensure_str(data.get("subtitles_path"))
                self.audio_path = _resolve_optional_path(audio_path_value)
                self.transcript_path = _resolve_optional_path(transcript_path_value)
                self.subtitles_path = _resolve_optional_path(subtitles_path_value)
                downloads: Dict[str, str] = {}
                if self.audio_path and self.audio_path.exists():
                    downloads["audio"] = f"/api/jobs/{self.job_id}/audio"
                if self.transcript_path and self.transcript_path.exists():
                    downloads["transcript"] = f"/api/jobs/{self.job_id}/transcript"
                if self.subtitles_path and self.subtitles_path.exists():
                    downloads["subtitles"] = f"/api/jobs/{self.job_id}/subtitles"
                if downloads:
                    data["downloads"] = downloads
                event.data = data
            payload = event.to_payload()
            self.history.append(payload)
            listeners_snapshot = list(self.listeners)
            if event.type == PipelineEventType.PIPELINE_COMPLETED:
                self.finished = True
                self.error = data.get("error")
                project_dir = _ensure_str(data.get("project_dir"))
                if project_dir:
                    try:
                        self.project_dir = Path(project_dir).resolve()
                    except OSError:
                        self.project_dir = None
            if event.type == PipelineEventType.CLIP_READY:
                self._ingest_clip_event(data)
        for queue in listeners_snapshot:
            self.loop.call_soon_threadsafe(queue.put_nowait, payload)

    def _ingest_clip_event(self, data: Dict[str, Any]) -> None:
        clip_id = _ensure_str(data.get("clip_id"))
        short_path = _ensure_str(data.get("short_path"))
        description = _ensure_str(data.get("description"))
        source_url = _ensure_str(data.get("source_url"))

        project_dir_str = _ensure_str(data.get("project_dir"))
        base = None
        if project_dir_str:
            try:
                base = Path(project_dir_str).resolve()
            except OSError:
                base = None
        if base is None and self.project_dir is not None:
            base = self.project_dir

        if not clip_id or not short_path or not description or not source_url or base is None:
            return

        try:
            video_path = (base / short_path).resolve()
            video_path.relative_to(base)
        except (OSError, ValueError):
            return

        created_at = _parse_datetime(data.get("created_at"))
        duration_value = _safe_float(data.get("duration_seconds"))
        if duration_value is None:
            duration_value = 0.0
        source_duration_value = _safe_float(data.get("source_duration_seconds"))
        if source_duration_value is not None and math.isfinite(source_duration_value):
            source_duration = max(0.0, source_duration_value)
        else:
            source_duration = None

        raw_start = data.get("start_seconds")
        raw_end = data.get("end_seconds")
        fallback_bounds = _parse_clip_bounds_from_id(clip_id)

        start_value = _safe_float(raw_start)
        if start_value is None or not math.isfinite(start_value):
            start_value = fallback_bounds[0] if fallback_bounds else 0.0
        end_value = _safe_float(raw_end)
        if end_value is None or not math.isfinite(end_value):
            if fallback_bounds is not None:
                end_value = fallback_bounds[1]
            else:
                end_value = start_value + max(0.0, duration_value)
        original_start_value = _safe_float(data.get("original_start_seconds"))
        if original_start_value is None or not math.isfinite(original_start_value):
            if fallback_bounds is not None:
                original_start_value = fallback_bounds[0]
            else:
                original_start_value = start_value
        original_end_value = _safe_float(data.get("original_end_seconds"))
        if original_end_value is None or not math.isfinite(original_end_value):
            if fallback_bounds is not None:
                original_end_value = fallback_bounds[1]
            else:
                original_end_value = end_value

        views_value = _safe_int(data.get("views"))
        rating_value = _safe_float(data.get("rating"))
        quote_value = _ensure_str(data.get("quote"))
        reason_value = _ensure_str(data.get("reason"))

        artifact = ClipArtifact(
            clip_id=clip_id,
            title=_ensure_str(data.get("title")) or clip_id,
            channel=_ensure_str(data.get("channel")) or "Unknown channel",
            source_title=_ensure_str(data.get("source_title")) or (_ensure_str(data.get("title")) or clip_id),
            source_url=source_url,
            source_published_at=_ensure_str(data.get("source_published_at")),
            created_at=created_at,
            duration_seconds=max(0.0, duration_value),
            description=description,
            video_path=video_path,
            account=_ensure_str(data.get("account")),
            views=views_value,
            rating=rating_value,
            quote=quote_value,
            reason=reason_value,
            start_seconds=max(0.0, start_value),
            end_seconds=max(0.0, end_value),
            original_start_seconds=max(0.0, original_start_value),
            original_end_seconds=max(0.0, original_end_value),
            source_duration_seconds=source_duration,
        )

        self.project_dir = base
        self.clips[clip_id] = artifact

    def register_listener(self) -> tuple[asyncio.Queue[Dict[str, Any]], List[Dict[str, Any]]]:
        """Register a websocket listener and return its queue and existing history."""

        queue: asyncio.Queue[Dict[str, Any]] = asyncio.Queue()
        with self.lock:
            self.listeners.append(queue)
            history_snapshot = list(self.history)
        return queue, history_snapshot

    def unregister_listener(self, queue: asyncio.Queue[Dict[str, Any]]) -> None:
        """Remove ``queue`` from the listener list."""

        with self.lock:
            if queue in self.listeners:
                self.listeners.remove(queue)

    def wait_for_resume(self) -> None:
        """Block until the job is resumed when review mode is active."""

        event = self.resume_event
        if not event:
            return
        event.wait()

    def resume(self) -> None:
        """Allow a paused job to continue processing."""

        event = self.resume_event
        if event and not event.is_set():
            event.set()


class BroadcastObserver(PipelineObserver):
    """Observer that forwards events to all websocket listeners."""

    def __init__(self, state: JobState):
        self._state = state

    def handle_event(self, event: PipelineEvent) -> None:
        self._state.publish(event)


_jobs: Dict[str, JobState] = {}
_jobs_lock = threading.Lock()


def _record_job(job_id: str, state: JobState) -> None:
    with _jobs_lock:
        _jobs[job_id] = state


def _get_job(job_id: str) -> JobState | None:
    with _jobs_lock:
        return _jobs.get(job_id)


def _resolve_description_path(video_path: Path) -> Path:
    """Return the best description file path for ``video_path``."""

    candidates = [
        video_path.with_suffix(".txt"),
        video_path.with_suffix(".md"),
        video_path.parent / "description.txt",
        video_path.parent / "description.md",
    ]
    for candidate in candidates:
        if candidate.exists() and candidate.is_file():
            return candidate
    raise HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail="Clip description not found",
    )


def _delete_clip_artifacts(video_path: Path) -> bool:
    """Delete the rendered clip file and related assets."""

    deleted = False
    parent = video_path.parent
    stem = video_path.stem
    for candidate in parent.glob(f"{stem}.*"):
        if not candidate.is_file():
            continue
        try:
            candidate.unlink()
            deleted = True
        except FileNotFoundError:
            continue
    try:
        if not any(parent.iterdir()):
            parent.rmdir()
            project_dir = parent.parent
            if project_dir.exists() and not any(project_dir.iterdir()):
                project_dir.rmdir()
    except OSError:
        pass
    return deleted


def _build_description_text(
    description_path: Path,
    *,
    source_url: str,
    channel: str,
    source_title: str,
    start_seconds: float,
    quote: str | None,
) -> str:
    """Regenerate the clip description using the adjusted boundaries."""

    tags = generate_hashtag_strings(title=source_title, quote=quote, show=channel)
    fallback_words: list[str] = []
    if not tags:
        fallback_words = [
            re.sub(r"[^0-9A-Za-z]", "", word)
            for word in source_title.split()
            if re.sub(r"[^0-9A-Za-z]", "", word)
        ][:3]
    hashtags = prepare_hashtags(tags + fallback_words + list(GENERIC_HASHTAGS), channel)
    hashtags.extend(["#shorts", "#withatropos"])

    full_video_link = youtube_timestamp_url(source_url, start_seconds)
    credited_channel = channel or "Unknown Channel"
    credited_title = source_title or "Original video"
    description = (
        f"Full video: {full_video_link}\n\n"
        f"Credit: {credited_channel} — {credited_title}\n"
        "Made by Atropos\n"
    )
    description = maybe_append_website_link(description)
    description += "\nIf you know any more creators who don't do clips, leave them in the comments below!\n"
    description += "\n" + " ".join(hashtags)

    description_path.parent.mkdir(parents=True, exist_ok=True)
    description_path.write_text(description, encoding="utf-8")
    return description


def _apply_clip_adjustment(
    *,
    project_dir: Path,
    stem: str,
    start_seconds: float,
    end_seconds: float,
    title: str,
    channel: str,
    source_url: str,
    source_title: str,
    quote: str | None,
    original_start_seconds: float,
    original_end_seconds: float,
) -> tuple[float, str]:
    """Rebuild clip assets for the provided ``stem`` using the new range."""

    if end_seconds <= start_seconds:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="End time must be greater than start time.",
        )

    project_dir = project_dir.resolve()
    if not project_dir.exists():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project directory not found")

    project_name = project_dir.name
    source_video = project_dir / f"{project_name}.mp4"
    transcript_path = project_dir / f"{project_name}.txt"
    if not source_video.exists():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Source video not found")
    if not transcript_path.exists():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Transcript not found")

    clips_dir = project_dir / "clips"
    subtitles_dir = project_dir / "subtitles"
    shorts_dir = project_dir / "shorts"
    clips_dir.mkdir(parents=True, exist_ok=True)
    subtitles_dir.mkdir(parents=True, exist_ok=True)
    shorts_dir.mkdir(parents=True, exist_ok=True)

    raw_clip_path = clips_dir / f"{stem}.mp4"
    subtitle_path = subtitles_dir / f"{stem}.srt"
    vertical_path = shorts_dir / f"{stem}.mp4"
    description_path = shorts_dir / f"{stem}.txt"

    ok = save_clip(
        source_video,
        raw_clip_path,
        start=start_seconds,
        end=end_seconds,
        reencode=False,
    )
    if not ok:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to cut clip with the requested boundaries.",
        )

    try:
        build_srt_for_range(
            transcript_path,
            global_start=start_seconds,
            global_end=end_seconds,
            srt_path=subtitle_path,
        )
    except Exception as exc:  # pragma: no cover - defensive
        logger.exception("Failed to rebuild subtitles for clip %s", stem, exc_info=exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to regenerate subtitles for the clip.",
        ) from exc

    try:
        render_vertical_with_captions(
            raw_clip_path,
            subtitle_path,
            vertical_path,
            layout=get_layout(pipeline_config.RENDER_LAYOUT),
        )
    except Exception as exc:  # pragma: no cover - defensive
        logger.exception("Failed to render adjusted clip %s", stem, exc_info=exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to render the adjusted clip.",
        ) from exc

    description_text = _build_description_text(
        description_path,
        source_url=source_url,
        channel=channel,
        source_title=source_title or title,
        start_seconds=start_seconds,
        quote=quote,
    )

    duration = max(0.0, end_seconds - start_seconds)
    write_adjustment_metadata(
        vertical_path,
        start_seconds=start_seconds,
        end_seconds=end_seconds,
        original_start_seconds=original_start_seconds,
        original_end_seconds=original_end_seconds,
    )
    return duration, description_text


def _validate_short_path(project_dir: Path, short_path: Path) -> Path:
    """Ensure ``short_path`` points to a rendered short within ``project_dir``."""

    project_dir = project_dir.resolve()
    if not project_dir.exists():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project directory not found")

    try:
        resolved_short = short_path.resolve(strict=True)
    except (OSError, FileNotFoundError) as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Rendered short not found",
        ) from exc

    try:
        resolved_short.relative_to(project_dir)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Rendered short not found",
        ) from exc

    return resolved_short


def _resolve_short_offsets(
    *,
    clip_start: float,
    clip_end: float,
    requested_start: float,
    requested_end: float,
) -> tuple[float, float]:
    """Normalise preview bounds so they align with the rendered short timeline."""

    clip_start_value = float(clip_start)
    clip_end_value = float(clip_end)
    if not math.isfinite(clip_start_value) or not math.isfinite(clip_end_value):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Clip bounds are invalid.")

    if clip_end_value <= clip_start_value:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Clip duration must be greater than zero.",
        )

    start_candidate = float(requested_start)
    end_candidate = float(requested_end)

    start_clamped = max(clip_start_value, min(start_candidate, clip_end_value))
    if start_clamped >= clip_end_value:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Preview range must be within the clip bounds.",
        )

    end_clamped = max(clip_start_value, min(end_candidate, clip_end_value))
    if end_clamped <= start_clamped:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Preview range must be greater than zero.",
        )

    start_offset = round(start_clamped - clip_start_value, 3)
    end_offset = round(end_clamped - clip_start_value, 3)
    if end_offset <= start_offset:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Preview range must be greater than zero.",
        )

    return start_offset, end_offset


def _generate_preview_clip(
    *,
    project_dir: Path,
    short_path: Path,
    start_offset: float,
    end_offset: float,
) -> Path:
    """Render or reuse a lightweight preview clip from the rendered short."""

    project_dir = project_dir.resolve()
    if not project_dir.exists():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project directory not found")

    short_video = _validate_short_path(project_dir, short_path)

    start_value = max(0.0, round(float(start_offset), 3))
    end_value = max(0.0, round(float(end_offset), 3))
    if end_value <= start_value:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Preview range must be greater than zero.",
        )

    preview_dir = project_dir / "previews"
    preview_dir.mkdir(parents=True, exist_ok=True)

    key_input = f"{short_video.stem}:{start_value:.3f}:{end_value:.3f}".encode("utf-8")
    digest = hashlib.sha1(key_input).hexdigest()[:16]
    preview_path = preview_dir / f"{short_video.stem}-{digest}.mp4"

    if not preview_path.exists():
        ok = save_clip(
            short_video,
            preview_path,
            start=start_value,
            end=end_value,
            reencode=False,
        )
        if not ok:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to generate preview clip.",
            )

    return preview_path


@app.post("/api/jobs", response_model=RunResponse, status_code=status.HTTP_202_ACCEPTED)
async def start_job(payload: RunRequest) -> RunResponse:
    """Start processing ``payload.url`` in a background thread."""

    job_id = uuid.uuid4().hex
    loop = asyncio.get_running_loop()
    state = JobState(job_id=job_id, loop=loop, review_mode=payload.review_mode)
    if payload.review_mode:
        state.resume_event = threading.Event()
    observer = BroadcastObserver(state)

    account_details: AccountResponse | None = None
    if payload.account:
        account_details = ensure_account_available(payload.account)

    source_kind = "remote"
    local_video_path: Path | None = None
    source_identifier = payload.url
    if payload.file_path:
        try:
            candidate = Path(payload.file_path).expanduser()
        except (TypeError, ValueError):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="The selected video file path is invalid. Choose another file and try again.",
            )
        try:
            resolved = candidate.resolve(strict=True)
        except FileNotFoundError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="The selected video file could not be found. Check the path and try again.",
            )
        except OSError as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Unable to access the selected video file. Confirm it is readable and try again.",
            ) from exc
        if not resolved.is_file():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Select a valid video file before starting the pipeline.",
            )
        if not os.access(resolved, os.R_OK):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Atropos does not have permission to read that video file. Adjust the file permissions and retry.",
            )
        source_kind = "local"
        local_video_path = resolved
        source_identifier = str(resolved)
        state.source_kind = "local"
    else:
        state.source_kind = "remote"
        if not source_identifier:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Provide a video URL or choose a local file to begin processing.",
            )

    def runner() -> None:
        try:
            selected_tone = payload.tone
            if (
                selected_tone is None
                and account_details is not None
                and account_details.tone is not None
            ):
                selected_tone = account_details.tone
            process_video(
                source_identifier,
                account=payload.account,
                tone=selected_tone,
                observer=observer,
                pause_for_review=payload.review_mode,
                review_gate=state.wait_for_resume if payload.review_mode else None,
                source_kind=source_kind,
                local_video_path=local_video_path,
            )
        except Exception as exc:  # pragma: no cover - exercised in integration
            logger.exception("Pipeline job %s failed", job_id)
            observer.handle_event(
                PipelineEvent(
                    type=PipelineEventType.PIPELINE_COMPLETED,
                    message="Pipeline failed",
                    data={"success": False, "error": str(exc)},
                )
            )

    thread = threading.Thread(target=runner, name=f"pipeline-{job_id}", daemon=True)
    state.thread = thread
    _record_job(job_id, state)
    thread.start()
    return RunResponse(job_id=job_id)


@app.post("/api/jobs/{job_id}/resume", status_code=status.HTTP_204_NO_CONTENT)
async def resume_job(job_id: str) -> Response:
    """Resume a paused pipeline job after manual clip review."""

    state = _get_job(job_id)
    if state is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found")
    if not state.review_mode or state.resume_event is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Job is not waiting for manual review.",
        )

    state.resume()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@app.get("/api/jobs/{job_id}", response_model=JobStatus)
async def get_job_status(job_id: str) -> JobStatus:
    """Return the completion status of ``job_id``."""

    state = _get_job(job_id)
    if state is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found")
    with state.lock:
        return JobStatus(job_id=job_id, finished=state.finished, error=state.error)


@app.websocket("/ws/jobs/{job_id}")
async def job_events(websocket: WebSocket, job_id: str) -> None:
    """Stream pipeline events for ``job_id`` to the connected websocket client."""

    state = _get_job(job_id)
    if state is None:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason="Job not found")
        return

    await websocket.accept()
    queue, history = state.register_listener()
    try:
        for event in history:
            await websocket.send_json(event)
        while True:
            payload = await queue.get()
            await websocket.send_json(payload)
            if payload.get("type") == PipelineEventType.PIPELINE_COMPLETED.value:
                break
    except WebSocketDisconnect:
        logger.info("Websocket disconnected for job %s", job_id)
    finally:
        state.unregister_listener(queue)


@app.get("/api/jobs/{job_id}/clips", response_model=list[ClipManifest])
async def list_job_clips(job_id: str, request: Request) -> list[ClipManifest]:
    """Return metadata for all clips generated by ``job_id``."""

    state = _get_job(job_id)
    if state is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found")

    with state.lock:
        clips = sorted(state.clips.values(), key=lambda clip: clip.created_at, reverse=True)

    return [ClipManifest(**_clip_to_payload(clip, request, job_id)) for clip in clips]


@app.get("/api/jobs/{job_id}/clips/{clip_id}", response_model=ClipManifest)
async def get_job_clip(job_id: str, clip_id: str, request: Request) -> ClipManifest:
    """Return metadata for a single clip produced by ``job_id``."""

    state = _get_job(job_id)
    if state is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found")

    with state.lock:
        clip = state.clips.get(clip_id)
    if clip is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Clip not found")

    return ClipManifest(**_clip_to_payload(clip, request, job_id))


@app.get("/api/jobs/{job_id}/clips/{clip_id}/video")
async def get_job_clip_video(job_id: str, clip_id: str) -> FileResponse:
    """Stream the rendered clip video for ``clip_id``."""

    state = _get_job(job_id)
    if state is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found")

    with state.lock:
        clip = state.clips.get(clip_id)
        video_path = clip.video_path if clip else None

    if clip is None or video_path is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Clip not found")

    if not video_path.exists() or not video_path.is_file():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Clip video not found")

    return FileResponse(path=video_path, media_type="video/mp4", filename=video_path.name)


@app.get("/api/jobs/{job_id}/clips/{clip_id}/preview")
async def get_job_clip_preview(
    job_id: str,
    clip_id: str,
    start: float | None = Query(default=None, ge=0.0),
    end: float | None = Query(default=None, ge=0.0),
) -> FileResponse:
    """Stream a lightweight preview of the clip derived from its rendered short."""

    state = _get_job(job_id)
    if state is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found")

    with state.lock:
        clip = state.clips.get(clip_id)
        project_dir = state.project_dir

    if clip is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Clip not found")

    clip_project_dir = clip.video_path.parent.parent
    if project_dir is None:
        project_dir = clip_project_dir
    else:
        try:
            clip_project_dir.relative_to(project_dir)
        except ValueError:
            project_dir = clip_project_dir

    clip_start = float(clip.start_seconds)
    clip_end = float(clip.end_seconds)
    requested_start = float(start) if start is not None else clip_start
    requested_end = float(end) if end is not None else clip_end

    start_offset, end_offset = _resolve_short_offsets(
        clip_start=clip_start,
        clip_end=clip_end,
        requested_start=requested_start,
        requested_end=requested_end,
    )

    preview_path = _generate_preview_clip(
        project_dir=project_dir,
        short_path=clip.video_path,
        start_offset=start_offset,
        end_offset=end_offset,
    )

    return FileResponse(
        path=preview_path,
        media_type="video/mp4",
        filename=preview_path.name,
        headers={"Cache-Control": "no-store"},
    )


@app.get("/api/jobs/{job_id}/audio")
async def get_job_audio(job_id: str) -> FileResponse:
    """Return the audio file generated for ``job_id`` if available."""

    state = _get_job(job_id)
    if state is None or state.audio_path is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Audio file not found")

    audio_path = state.audio_path
    if not audio_path.exists() or not audio_path.is_file():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Audio file not found")

    return FileResponse(path=audio_path, media_type="audio/mpeg", filename=audio_path.name)


@app.get("/api/jobs/{job_id}/transcript")
async def get_job_transcript(job_id: str) -> FileResponse:
    """Return the Whisper transcript for ``job_id``."""

    state = _get_job(job_id)
    if state is None or state.transcript_path is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Transcript not found")

    transcript_path = state.transcript_path
    if not transcript_path.exists() or not transcript_path.is_file():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Transcript not found")

    return FileResponse(path=transcript_path, media_type="text/plain", filename=transcript_path.name)


@app.get("/api/jobs/{job_id}/subtitles")
async def get_job_subtitles(job_id: str) -> FileResponse:
    """Return a ZIP archive of caption files for ``job_id``."""

    state = _get_job(job_id)
    if state is None or state.subtitles_path is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Subtitles not available")

    archive_path = state.subtitles_path
    if not archive_path.exists() or not archive_path.is_file():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Subtitles not available")

    return FileResponse(
        path=archive_path,
        media_type="application/zip",
        filename=archive_path.name,
    )


def _generate_clip_thumbnail(
    *,
    project_dir: Path,
    short_path: Path,
    start_offset: float,
    end_offset: float,
) -> Path:
    """Create or reuse a JPEG thumbnail derived from the rendered short."""

    project_dir = project_dir.resolve()
    if not project_dir.exists():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project directory not found")

    short_video = _validate_short_path(project_dir, short_path)

    thumbnails_dir = project_dir / "thumbnails"
    thumbnails_dir.mkdir(parents=True, exist_ok=True)

    start_value = max(0.0, float(start_offset))
    end_value = max(0.0, float(end_offset))
    duration = max(0.0, end_value - start_value)
    midpoint = start_value + (duration * 0.5 if duration > 0 else 0.0)
    midpoint = max(start_value, min(end_value, midpoint))

    key_input = f"{short_video.stem}:{midpoint:.3f}".encode("utf-8")
    digest = hashlib.sha1(key_input).hexdigest()[:16]
    thumbnail_path = thumbnails_dir / f"{short_video.stem}-{digest}.jpg"

    if thumbnail_path.exists():
        return thumbnail_path

    command = [
        "ffmpeg",
        "-y",
        "-ss",
        f"{midpoint:.3f}",
        "-i",
        str(short_video),
        "-frames:v",
        "1",
        "-q:v",
        "2",
        str(thumbnail_path),
    ]

    try:
        subprocess.run(command, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    except FileNotFoundError as exc:  # pragma: no cover - depends on ffmpeg availability
        logger.exception("ffmpeg is required to render thumbnails", exc_info=exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Unable to generate thumbnail",
        ) from exc
    except subprocess.CalledProcessError as exc:  # pragma: no cover - defensive guard
        logger.exception(
            "Failed to render thumbnail for clip %s", short_video.stem, exc_info=exc
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Unable to generate thumbnail",
        ) from exc

    if not thumbnail_path.exists():  # pragma: no cover - defensive guard
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Unable to generate thumbnail",
        )

    return thumbnail_path


@app.post("/api/jobs/{job_id}/clips/{clip_id}/adjust", response_model=ClipManifest)
async def adjust_job_clip(
    job_id: str,
    clip_id: str,
    payload: ClipAdjustmentRequest,
    request: Request,
) -> ClipManifest:
    """Adjust the boundaries of a clip produced by an in-flight job."""

    state = _get_job(job_id)
    if state is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found")

    with state.lock:
        clip = state.clips.get(clip_id)
        project_dir = state.project_dir

    if clip is None or project_dir is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Clip not found")

    start_seconds = float(payload.start_seconds)
    end_seconds = float(payload.end_seconds)

    duration, description_text = _apply_clip_adjustment(
        project_dir=project_dir,
        stem=clip.video_path.stem,
        start_seconds=start_seconds,
        end_seconds=end_seconds,
        title=clip.title,
        channel=clip.channel,
        source_url=clip.source_url,
        source_title=clip.source_title,
        quote=clip.quote,
        original_start_seconds=clip.original_start_seconds,
        original_end_seconds=clip.original_end_seconds,
    )

    updated = ClipArtifact(
        clip_id=clip.clip_id,
        title=clip.title,
        channel=clip.channel,
        source_title=clip.source_title,
        source_url=clip.source_url,
        source_published_at=clip.source_published_at,
        created_at=datetime.now(timezone.utc),
        duration_seconds=duration,
        description=description_text,
        video_path=clip.video_path,
        account=clip.account,
        views=clip.views,
        rating=clip.rating,
        quote=clip.quote,
        reason=clip.reason,
        start_seconds=max(0.0, start_seconds),
        end_seconds=max(0.0, end_seconds),
        original_start_seconds=clip.original_start_seconds,
        original_end_seconds=clip.original_end_seconds,
        source_duration_seconds=clip.source_duration_seconds,
    )

    with state.lock:
        state.clips[clip_id] = updated

    return ClipManifest(**_clip_to_payload(updated, request, job_id))


@app.post("/api/jobs/{job_id}/clips/{clip_id}/upload", response_model=UploadClipResponse)
async def upload_job_clip(job_id: str, clip_id: str, payload: UploadClipRequest) -> UploadClipResponse:
    """Trigger uploads for ``clip_id`` to the selected platforms."""

    state = _get_job(job_id)
    if state is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found")

    with state.lock:
        clip = state.clips.get(clip_id)

    if clip is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Clip not found")

    video_path = clip.video_path
    if not video_path.exists() or not video_path.is_file():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Clip video not found")

    desc_path = _resolve_description_path(video_path)

    requested = payload.platforms
    if requested is None:
        platform_list = list(SUPPORTED_PLATFORMS)
    else:
        seen: set[str] = set()
        platform_list: list[str] = []
        invalid: list[str] = []
        for name in requested:
            normalised = name.lower()
            if normalised not in SUPPORTED_PLATFORMS:
                invalid.append(normalised)
                continue
            if normalised not in seen:
                seen.add(normalised)
                platform_list.append(normalised)
        if invalid:
            invalid_tokens = ", ".join(sorted(set(invalid)))
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Unknown platforms requested: {invalid_tokens}",
            )
        if not platform_list:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Select at least one platform to upload to.",
            )

    delete_after = payload.delete_after_upload
    if delete_after is None:
        delete_after = getattr(pipeline_config, "DELETE_UPLOADED_CLIPS", False)

    try:
        await asyncio.to_thread(
            run_uploads,
            video_path,
            desc_path,
            account=clip.account,
            platforms=platform_list,
        )
    except Exception as exc:  # pragma: no cover - defensive logging
        logger.exception("Upload failed for job %s clip %s", job_id, clip_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Upload failed: {exc}",
        ) from exc

    deleted = False
    if delete_after:
        deleted = await asyncio.to_thread(_delete_clip_artifacts, video_path)
        if deleted:
            with state.lock:
                state.clips.pop(clip_id, None)

    return UploadClipResponse(success=True, deleted=deleted, platforms=platform_list)


@app.get("/api/accounts/{account_id}/clips", response_model=list[LibraryClipManifest])
async def list_account_clip_library(account_id: str, request: Request) -> list[LibraryClipManifest]:
    """Return stored clips for ``account_id`` from the library."""

    account_value = None if account_id == DEFAULT_ACCOUNT_PLACEHOLDER else account_id
    clips = await list_account_clips(account_value)
    return [LibraryClipManifest(**clip.to_payload(request)) for clip in clips]


@app.get("/api/accounts/{account_id}/clips/{clip_id}", response_model=LibraryClipManifest)
async def get_account_clip(account_id: str, clip_id: str, request: Request) -> LibraryClipManifest:
    """Return metadata for a single clip from the library."""

    account_value = None if account_id == DEFAULT_ACCOUNT_PLACEHOLDER else account_id
    clips = list_account_clips_sync(account_value)
    target = next((clip for clip in clips if clip.clip_id == clip_id), None)
    if target is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Clip not found")

    return LibraryClipManifest(**target.to_payload(request))


@app.get("/api/accounts/{account_id}/clips/{clip_id}/video")
async def get_account_clip_video(account_id: str, clip_id: str) -> FileResponse:
    """Stream the archived clip video for ``clip_id``."""

    account_value = None if account_id == DEFAULT_ACCOUNT_PLACEHOLDER else account_id
    clip_path = resolve_clip_video_path(account_value, clip_id)
    return FileResponse(path=clip_path, media_type="video/mp4", filename=clip_path.name)


@app.get("/api/accounts/{account_id}/clips/{clip_id}/preview")
async def get_account_clip_preview(
    account_id: str,
    clip_id: str,
    start: float | None = Query(default=None, ge=0.0),
    end: float | None = Query(default=None, ge=0.0),
) -> FileResponse:
    """Stream a preview of a library clip derived from the rendered short."""

    account_value = None if account_id == DEFAULT_ACCOUNT_PLACEHOLDER else account_id
    clips = list_account_clips_sync(account_value)
    target = next((clip for clip in clips if clip.clip_id == clip_id), None)
    if target is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Clip not found")

    project_dir = target.playback_path.parent.parent

    clip_start = float(target.start_seconds)
    clip_end = float(target.end_seconds)
    requested_start = float(start) if start is not None else clip_start
    requested_end = float(end) if end is not None else clip_end

    start_offset, end_offset = _resolve_short_offsets(
        clip_start=clip_start,
        clip_end=clip_end,
        requested_start=requested_start,
        requested_end=requested_end,
    )

    preview_path = _generate_preview_clip(
        project_dir=project_dir,
        short_path=target.playback_path,
        start_offset=start_offset,
        end_offset=end_offset,
    )

    return FileResponse(
        path=preview_path,
        media_type="video/mp4",
        filename=preview_path.name,
        headers={"Cache-Control": "no-store"},
    )


@app.get("/api/accounts/{account_id}/clips/{clip_id}/thumbnail")
async def get_account_clip_thumbnail(account_id: str, clip_id: str) -> FileResponse:
    """Return a generated thumbnail image for the requested clip."""

    account_value = None if account_id == DEFAULT_ACCOUNT_PLACEHOLDER else account_id
    clips = list_account_clips_sync(account_value)
    target = next((clip for clip in clips if clip.clip_id == clip_id), None)
    if target is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Clip not found")

    project_dir = target.playback_path.parent.parent

    clip_start = float(target.start_seconds)
    clip_end = float(target.end_seconds)
    start_offset, end_offset = _resolve_short_offsets(
        clip_start=clip_start,
        clip_end=clip_end,
        requested_start=clip_start,
        requested_end=clip_end,
    )

    thumbnail_path = _generate_clip_thumbnail(
        project_dir=project_dir,
        short_path=target.playback_path,
        start_offset=start_offset,
        end_offset=end_offset,
    )

    return FileResponse(
        path=thumbnail_path,
        media_type="image/jpeg",
        filename=thumbnail_path.name,
        headers={"Cache-Control": "no-store"},
    )


@app.post(
    "/api/accounts/{account_id}/clips/{clip_id}/adjust",
    response_model=LibraryClipManifest,
)
async def adjust_library_clip(
    account_id: str,
    clip_id: str,
    payload: ClipAdjustmentRequest,
    request: Request,
) -> LibraryClipManifest:
    """Adjust clip boundaries for a library clip and rebuild derived assets."""

    account_value = None if account_id == DEFAULT_ACCOUNT_PLACEHOLDER else account_id
    clips = list_account_clips_sync(account_value)
    target = next((clip for clip in clips if clip.clip_id == clip_id), None)
    if target is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Clip not found")

    project_dir = target.playback_path.parent.parent
    _apply_clip_adjustment(
        project_dir=project_dir,
        stem=target.playback_path.stem,
        start_seconds=float(payload.start_seconds),
        end_seconds=float(payload.end_seconds),
        title=target.title,
        channel=target.channel,
        source_url=target.source_url,
        source_title=target.source_title,
        quote=target.quote,
        original_start_seconds=target.original_start_seconds,
        original_end_seconds=target.original_end_seconds,
    )

    refreshed = list_account_clips_sync(account_value)
    updated = next((clip for clip in refreshed if clip.clip_id == clip_id), None)
    if updated is None:  # pragma: no cover - defensive
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Clip metadata could not be refreshed",
        )

    return LibraryClipManifest(**updated.to_payload(request))


@app.get("/api/accounts", response_model=list[AccountResponse])
async def get_accounts() -> list[AccountResponse]:
    """Return the list of configured publishing accounts."""

    return list_accounts()


@app.post("/api/accounts", response_model=AccountResponse, status_code=status.HTTP_201_CREATED)
async def post_account(payload: AccountCreateRequest) -> AccountResponse:
    """Create a new account entry and return its metadata."""

    return create_account(payload)


@app.patch("/api/accounts/{account_id}", response_model=AccountResponse)
async def patch_account(account_id: str, payload: AccountUpdateRequest) -> AccountResponse:
    """Update an account's mutable fields such as its active state."""

    return update_account(account_id, payload)


@app.delete(
    "/api/accounts/{account_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
)
async def delete_account_route(account_id: str) -> Response:
    """Remove an account and associated tokens from disk."""

    delete_account(account_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@app.post("/api/accounts/{account_id}/platforms", response_model=AccountResponse)
async def post_account_platform(
    account_id: str, payload: PlatformCreateRequest
) -> AccountResponse:
    """Add a platform connection to an account and persist credentials."""

    return add_platform(account_id, payload)


@app.patch("/api/accounts/{account_id}/platforms/{platform}", response_model=AccountResponse)
async def patch_account_platform(
    account_id: str, platform: str, payload: PlatformUpdateRequest
) -> AccountResponse:
    """Update an existing platform connection (e.g. disable or enable it)."""

    return update_platform(account_id, platform, payload)


@app.delete(
    "/api/accounts/{account_id}/platforms/{platform}",
    response_model=AccountResponse,
)
async def delete_account_platform(account_id: str, platform: str) -> AccountResponse:
    """Remove a platform connection and delete its stored tokens."""

    return delete_platform(account_id, platform)


@app.get("/api/auth/ping", response_model=AuthPingResponse)
async def auth_ping() -> AuthPingResponse:
    """Report the overall authentication health."""

    return ping_authentication()


@app.get("/api/config", response_model=list[ConfigEntry])
async def list_configuration() -> list[ConfigEntry]:
    """Expose the current configuration values."""

    return [_build_config_entry(name) for name in CONFIG_ATTRIBUTE_NAMES]


@app.patch("/api/config", response_model=list[ConfigEntry])
async def update_configuration(payload: ConfigUpdateRequest) -> list[ConfigEntry]:
    """Apply configuration overrides at runtime."""

    if not payload.values:
        return [_build_config_entry(name) for name in CONFIG_ATTRIBUTE_NAMES]

    for name, value in payload.values.items():
        if name not in _CONFIG_ALLOWED_NAMES:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Unknown configuration '{name}'.",
            )
        try:
            _apply_config_update(name, value)
        except ValueError as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)
            ) from exc

    return [_build_config_entry(name) for name in CONFIG_ATTRIBUTE_NAMES]
