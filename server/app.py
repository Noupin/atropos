"""FastAPI application exposing the Atropos pipeline over REST and WebSockets."""

from __future__ import annotations

import asyncio
import logging
import threading
import uuid
from dataclasses import dataclass, field, fields, is_dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List

from fastapi import (
    FastAPI,
    HTTPException,
    Request,
    Response,
    WebSocket,
    WebSocketDisconnect,
    status,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field, field_validator

from custom_types.ETone import Tone
from interfaces.progress import PipelineEvent, PipelineEventType, PipelineObserver
from pipeline import process_video
from library import (
    DEFAULT_ACCOUNT_PLACEHOLDER,
    list_account_clips,
    resolve_clip_video_path,
)
from auth.accounts import (
    AccountCreateRequest,
    AccountResponse,
    AccountUpdateRequest,
    AuthPingResponse,
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

logger = logging.getLogger(__name__)

app = FastAPI(title="Atropos Pipeline API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


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


class RunRequest(BaseModel):
    """Payload for starting a new pipeline job."""

    url: str = Field(..., min_length=1)
    account: str | None = Field(default=None, max_length=128)
    tone: Tone | None = Field(default=None)

    @field_validator("tone", mode="before")
    @classmethod
    def _parse_tone(cls, value: Any) -> Tone | None:
        if value is None or isinstance(value, Tone):
            return value
        try:
            return Tone(value)
        except ValueError as exc:  # pragma: no cover - validation branch
            raise ValueError(f"Unknown tone '{value}'") from exc


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


class ClipManifest(BaseModel):
    """API representation of a clip available for review."""

    id: str
    title: str
    channel: str
    created_at: datetime
    duration_seconds: float = Field(..., ge=0)
    description: str
    playback_url: str
    source_url: str
    source_title: str
    source_published_at: str | None = None
    views: int | None = None
    rating: float | None = None
    quote: str | None = None
    reason: str | None = None
    account: str | None = None


class LibraryClipManifest(ClipManifest):
    """Extended manifest for archived library clips."""

    timestamp_url: str | None = None
    timestamp_seconds: float | None = None
    thumbnail_url: str | None = None


def _clip_to_payload(clip: ClipArtifact, request: Request, job_id: str) -> Dict[str, Any]:
    """Return a serialisable payload for ``clip``."""

    return {
        "id": clip.clip_id,
        "title": clip.title,
        "channel": clip.channel,
        "created_at": clip.created_at,
        "duration_seconds": clip.duration_seconds,
        "description": clip.description,
        "playback_url": str(
            request.url_for("get_job_clip_video", job_id=job_id, clip_id=clip.clip_id)
        ),
        "source_url": clip.source_url,
        "source_title": clip.source_title,
        "source_published_at": clip.source_published_at,
        "views": clip.views,
        "rating": clip.rating,
        "quote": clip.quote,
        "reason": clip.reason,
        "account": clip.account,
    }


@dataclass
class JobState:
    """Holds state shared between the worker thread and websocket clients."""

    loop: asyncio.AbstractEventLoop
    history: List[Dict[str, Any]] = field(default_factory=list)
    listeners: List[asyncio.Queue[Dict[str, Any]]] = field(default_factory=list)
    lock: threading.Lock = field(default_factory=threading.Lock)
    finished: bool = False
    error: str | None = None
    thread: threading.Thread | None = None
    project_dir: Path | None = None
    clips: Dict[str, ClipArtifact] = field(default_factory=dict)

    def publish(self, event: PipelineEvent) -> None:
        """Broadcast ``event`` to all listeners and append it to history."""

        payload = event.to_payload()
        with self.lock:
            self.history.append(payload)
            listeners_snapshot = list(self.listeners)
            data = event.data or {}
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


@app.post("/api/jobs", response_model=RunResponse, status_code=status.HTTP_202_ACCEPTED)
async def start_job(payload: RunRequest) -> RunResponse:
    """Start processing ``payload.url`` in a background thread."""

    job_id = uuid.uuid4().hex
    loop = asyncio.get_running_loop()
    state = JobState(loop=loop)
    observer = BroadcastObserver(state)

    if payload.account:
        ensure_account_available(payload.account)

    def runner() -> None:
        try:
            process_video(
                payload.url,
                account=payload.account,
                tone=payload.tone,
                observer=observer,
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


@app.get("/api/accounts/{account_id}/clips", response_model=list[LibraryClipManifest])
async def list_account_clip_library(account_id: str, request: Request) -> list[LibraryClipManifest]:
    """Return stored clips for ``account_id`` from the library."""

    account_value = None if account_id == DEFAULT_ACCOUNT_PLACEHOLDER else account_id
    clips = await list_account_clips(account_value)
    return [LibraryClipManifest(**clip.to_payload(request)) for clip in clips]


@app.get("/api/accounts/{account_id}/clips/{clip_id}/video")
async def get_account_clip_video(account_id: str, clip_id: str) -> FileResponse:
    """Stream the archived clip video for ``clip_id``."""

    account_value = None if account_id == DEFAULT_ACCOUNT_PLACEHOLDER else account_id
    clip_path = resolve_clip_video_path(account_value, clip_id)
    return FileResponse(path=clip_path, media_type="video/mp4", filename=clip_path.name)


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
