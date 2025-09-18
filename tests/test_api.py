"""Tests for the FastAPI application exposing the pipeline."""

from __future__ import annotations

import time
from datetime import datetime, timezone
from pathlib import Path
from typing import List

from fastapi.testclient import TestClient

import server.app
from interfaces.progress import PipelineEvent, PipelineEventType


def test_job_lifecycle(monkeypatch) -> None:
    events: List[PipelineEvent] = [
        PipelineEvent(type=PipelineEventType.PIPELINE_STARTED, data={"success": False}),
        PipelineEvent(type=PipelineEventType.STEP_STARTED, step="demo", message="Demo"),
        PipelineEvent(
            type=PipelineEventType.PIPELINE_COMPLETED,
            data={"success": True, "elapsed_seconds": 0.1},
        ),
    ]

    def _fake_process(url: str, account=None, tone=None, observer=None) -> None:
        assert observer is not None
        for event in events:
            observer.handle_event(event)

    monkeypatch.setattr(server.app, "process_video", _fake_process)

    client = TestClient(server.app.app)
    response = client.post("/api/jobs", json={"url": "https://example.com/video"})
    assert response.status_code == 202
    job_id = response.json()["job_id"]

    received: List[dict] = []
    with client.websocket_connect(f"/ws/jobs/{job_id}") as websocket:
        while True:
            payload = websocket.receive_json()
            received.append(payload)
            if payload["type"] == PipelineEventType.PIPELINE_COMPLETED.value:
                break

    status_response = client.get(f"/api/jobs/{job_id}")
    assert status_response.status_code == 200
    assert status_response.json()["finished"] is True

    types = [payload["type"] for payload in received]
    assert types[0] == PipelineEventType.PIPELINE_STARTED.value
    assert types[-1] == PipelineEventType.PIPELINE_COMPLETED.value

    with server.app._jobs_lock:
        server.app._jobs.clear()


def test_clip_endpoints_expose_rendered_clips(
    monkeypatch, tmp_path: Path
) -> None:
    project_dir = tmp_path / "project"
    shorts_dir = project_dir / "shorts"
    shorts_dir.mkdir(parents=True)
    video_path = shorts_dir / "clip-1.mp4"
    video_bytes = b"fake-video"
    video_path.write_bytes(video_bytes)
    description = "Full video: https://youtube.com/watch?v=abc\n#space"
    created_at = datetime(2024, 6, 1, 12, 0, tzinfo=timezone.utc)

    def _fake_process(url: str, account=None, tone=None, observer=None) -> None:
        assert observer is not None
        observer.handle_event(
            PipelineEvent(
                type=PipelineEventType.PIPELINE_STARTED,
                data={"url": url},
            )
        )
        observer.handle_event(
            PipelineEvent(
                type=PipelineEventType.CLIP_READY,
                step="step_9_description_1",
                data={
                    "clip_id": "clip-1",
                    "title": "Space wonders",
                    "channel": "Creator Hub",
                    "description": description,
                    "duration_seconds": 12.5,
                    "created_at": created_at.isoformat(),
                    "source_url": "https://youtube.com/watch?v=abc",
                    "source_title": "Original science video",
                    "source_published_at": created_at.isoformat(),
                    "short_path": video_path.relative_to(project_dir).as_posix(),
                    "project_dir": str(project_dir),
                    "account": "account-1",
                    "views": 123_000,
                    "rating": 4.5,
                    "quote": "Mind-blowing fact",
                    "reason": "High energy moment",
                },
            )
        )
        observer.handle_event(
            PipelineEvent(
                type=PipelineEventType.PIPELINE_COMPLETED,
                data={"success": True, "project_dir": str(project_dir)},
            )
        )

    monkeypatch.setattr(server.app, "process_video", _fake_process)

    client = TestClient(server.app.app)
    response = client.post("/api/jobs", json={"url": "https://example.com/video"})
    assert response.status_code == 202
    job_id = response.json()["job_id"]

    for _ in range(100):
        status_response = client.get(f"/api/jobs/{job_id}")
        assert status_response.status_code == 200
        if status_response.json()["finished"]:
            break
        time.sleep(0.01)
    else:  # pragma: no cover - defensive guard
        raise AssertionError("Pipeline job did not finish")

    clips_response = client.get(f"/api/jobs/{job_id}/clips")
    assert clips_response.status_code == 200
    payload = clips_response.json()
    assert isinstance(payload, list)
    assert len(payload) == 1
    clip_manifest = payload[0]
    assert clip_manifest["id"] == "clip-1"
    assert clip_manifest["description"] == description
    assert clip_manifest["account"] == "account-1"
    assert clip_manifest["playback_url"].endswith("/clips/clip-1/video")

    detail_response = client.get(f"/api/jobs/{job_id}/clips/clip-1")
    assert detail_response.status_code == 200
    assert detail_response.json()["id"] == "clip-1"

    video_response = client.get(f"/api/jobs/{job_id}/clips/clip-1/video")
    assert video_response.status_code == 200
    assert video_response.content == video_bytes

    state = server.app._get_job(job_id)
    if state and state.thread is not None:
        state.thread.join(timeout=1)
    with server.app._jobs_lock:
        server.app._jobs.clear()
