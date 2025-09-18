"""FastAPI application exposing the Atropos pipeline over REST and WebSockets."""

from __future__ import annotations

import asyncio
import logging
import threading
import uuid
from dataclasses import dataclass, field
from typing import Any, Dict, List

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, field_validator

from custom_types.ETone import Tone
from interfaces.progress import PipelineEvent, PipelineEventType, PipelineObserver
from pipeline import process_video
from auth.accounts import (
    AccountCreateRequest,
    AccountResponse,
    AuthPingResponse,
    PlatformCreateRequest,
    add_platform,
    create_account,
    list_accounts,
    ping_authentication,
)

logger = logging.getLogger(__name__)

app = FastAPI(title="Atropos Pipeline API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


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

    def publish(self, event: PipelineEvent) -> None:
        """Broadcast ``event`` to all listeners and append it to history."""

        payload = event.to_payload()
        with self.lock:
            self.history.append(payload)
            listeners_snapshot = list(self.listeners)
            if event.type == PipelineEventType.PIPELINE_COMPLETED:
                self.finished = True
                data = event.data or {}
                self.error = data.get("error")
        for queue in listeners_snapshot:
            self.loop.call_soon_threadsafe(queue.put_nowait, payload)

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


@app.get("/api/accounts", response_model=list[AccountResponse])
async def get_accounts() -> list[AccountResponse]:
    """Return the list of configured publishing accounts."""

    return list_accounts()


@app.post("/api/accounts", response_model=AccountResponse, status_code=status.HTTP_201_CREATED)
async def post_account(payload: AccountCreateRequest) -> AccountResponse:
    """Create a new account entry and return its metadata."""

    return create_account(payload)


@app.post("/api/accounts/{account_id}/platforms", response_model=AccountResponse)
async def post_account_platform(
    account_id: str, payload: PlatformCreateRequest
) -> AccountResponse:
    """Add a platform connection to an account and persist credentials."""

    return add_platform(account_id, payload)


@app.get("/api/auth/ping", response_model=AuthPingResponse)
async def auth_ping() -> AuthPingResponse:
    """Report the overall authentication health."""

    return ping_authentication()
