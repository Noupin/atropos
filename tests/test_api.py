"""Tests for the FastAPI application exposing the pipeline."""

from __future__ import annotations

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
