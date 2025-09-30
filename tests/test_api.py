"""Tests for the FastAPI application exposing the pipeline."""

from __future__ import annotations

import asyncio
import base64
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import List
from urllib.parse import urlparse

import pytest

from fastapi.testclient import TestClient

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "server"))


def _base64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


_TEST_PRIVATE_KEY = Ed25519PrivateKey.generate()
_TEST_PUBLIC_KEY = _TEST_PRIVATE_KEY.public_key()
_TEST_PUBLIC_BYTES = _TEST_PUBLIC_KEY.public_bytes(
    encoding=serialization.Encoding.Raw,
    format=serialization.PublicFormat.Raw,
)

os.environ.setdefault(
    "WORKER_JWT_PUBLIC_KEY",
    json.dumps({"kty": "OKP", "crv": "Ed25519", "x": _base64url(_TEST_PUBLIC_BYTES)}),
)


def _issue_worker_token(expiration_seconds: int = 3600) -> str:
    header = {"alg": "EdDSA", "typ": "JWT"}
    payload = {"sub": "test-user", "exp": int(time.time()) + expiration_seconds}
    header_segment = _base64url(
        json.dumps(header, separators=(",", ":"), sort_keys=True).encode("utf-8")
    )
    payload_segment = _base64url(
        json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")
    )
    signing_input = f"{header_segment}.{payload_segment}".encode("utf-8")
    signature = _TEST_PRIVATE_KEY.sign(signing_input)
    signature_segment = _base64url(signature)
    return f"{header_segment}.{payload_segment}.{signature_segment}"


def _auth_headers() -> dict[str, str]:
    return {"Authorization": f"Bearer {_issue_worker_token()}"}


def _make_authenticated_client() -> tuple[TestClient, dict[str, str]]:
    headers = _auth_headers()
    client = TestClient(server.app.app)
    client.headers.update(headers)
    return client, headers

import server.app
import server.config as pipeline_config
import server.library
from interfaces.progress import PipelineEvent, PipelineEventType


def test_pipeline_requires_worker_token() -> None:
    client = TestClient(server.app.app)
    response = client.post("/api/jobs", json={"url": "https://example.com/video"})
    assert response.status_code == 401


def test_job_lifecycle(monkeypatch) -> None:
    events: List[PipelineEvent] = [
        PipelineEvent(type=PipelineEventType.PIPELINE_STARTED, data={"success": False}),
        PipelineEvent(type=PipelineEventType.STEP_STARTED, step="demo", message="Demo"),
        PipelineEvent(
            type=PipelineEventType.PIPELINE_COMPLETED,
            data={"success": True, "elapsed_seconds": 0.1},
        ),
    ]

    def _fake_process(
        url: str,
        account=None,
        tone=None,
        observer=None,
        *,
        pause_for_review: bool = False,
        review_gate=None,
    ) -> None:
        assert observer is not None
        for event in events:
            observer.handle_event(event)

    monkeypatch.setattr(server.app, "process_video", _fake_process)

    client, headers = _make_authenticated_client()
    response = client.post("/api/jobs", json={"url": "https://example.com/video"})
    assert response.status_code == 202
    job_id = response.json()["job_id"]

    received: List[dict] = []
    with client.websocket_connect(f"/ws/jobs/{job_id}", headers=headers) as websocket:
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


def test_job_resume_unblocks_review_mode(monkeypatch) -> None:
    def _fake_process(
        url: str,
        account=None,
        tone=None,
        observer=None,
        *,
        pause_for_review: bool = False,
        review_gate=None,
    ) -> None:
        assert observer is not None
        observer.handle_event(
            PipelineEvent(
                type=PipelineEventType.PIPELINE_STARTED,
                data={"url": url},
            )
        )
        if pause_for_review and review_gate is not None:
            review_gate()
        observer.handle_event(
            PipelineEvent(
                type=PipelineEventType.PIPELINE_COMPLETED,
                data={"success": True},
            )
        )

    monkeypatch.setattr(server.app, "process_video", _fake_process)

    client, _ = _make_authenticated_client()
    response = client.post(
        "/api/jobs",
        json={"url": "https://example.com/video", "review_mode": True},
    )
    assert response.status_code == 202
    job_id = response.json()["job_id"]

    # Job should be waiting for resume before finishing
    for _ in range(20):
        status_response = client.get(f"/api/jobs/{job_id}")
        assert status_response.status_code == 200
        if status_response.json()["finished"]:
            break
        time.sleep(0.01)
    else:
        status_payload = status_response.json()
        assert status_payload["finished"] is False

    resume_response = client.post(f"/api/jobs/{job_id}/resume")
    assert resume_response.status_code == 204

    for _ in range(100):
        status_response = client.get(f"/api/jobs/{job_id}")
        assert status_response.status_code == 200
        if status_response.json()["finished"]:
            break
        time.sleep(0.01)
    else:  # pragma: no cover - defensive guard
        raise AssertionError("Pipeline job did not finish after resume")

    state = server.app._get_job(job_id)
    if state and state.thread is not None:
        state.thread.join(timeout=1)
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

    def _fake_process(
        url: str,
        account=None,
        tone=None,
        observer=None,
        *,
        pause_for_review: bool = False,
        review_gate=None,
    ) -> None:
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
                step="step_7_descriptions_1",
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

    client, _ = _make_authenticated_client()
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
    assert clip_manifest["preview_url"].endswith("/clips/clip-1/preview")

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


def test_adjust_job_clip_rebuilds_assets(monkeypatch, tmp_path: Path) -> None:
    project_dir = tmp_path / "Sample_Project"
    project_dir.mkdir()
    shorts_dir = project_dir / "shorts"
    clips_dir = project_dir / "clips"
    subtitles_dir = project_dir / "subtitles"
    shorts_dir.mkdir()
    clips_dir.mkdir()
    subtitles_dir.mkdir()

    video_path = project_dir / "Sample_Project.mp4"
    video_path.write_bytes(b"video")
    transcript_path = project_dir / "Sample_Project.txt"
    transcript_path.write_text("[0.00 -> 30.00] Hello world", encoding="utf-8")

    stem = "clip_5.00-15.00_r9.0"
    raw_clip_path = clips_dir / f"{stem}.mp4"
    raw_clip_path.write_bytes(b"raw")
    subtitle_path = subtitles_dir / f"{stem}.srt"
    subtitle_path.write_text(
        "1\n00:00:00,000 --> 00:00:02,000\nHi\n\n",
        encoding="utf-8",
    )
    vertical_path = shorts_dir / f"{stem}.mp4"
    vertical_path.write_bytes(b"vertical")
    description_path = shorts_dir / f"{stem}.txt"
    description_path.write_text(
        "Full video: https://youtube.com/watch?v=abc&t=5\nCredit: Creator\nMade by Atropos",
        encoding="utf-8",
    )

    def _fake_save_clip(source, output_path, *_, **__) -> bool:
        target = Path(output_path)
        target.parent.mkdir(parents=True, exist_ok=True)
        if target == raw_clip_path:
            target.write_bytes(b"raw-updated")
        else:
            target.write_bytes(b"preview-bytes")
        return True

    def _fake_render_vertical(*_, **__) -> Path:
        vertical_path.write_bytes(b"vertical-updated")
        return vertical_path

    monkeypatch.setattr(server.app, "save_clip", _fake_save_clip)
    monkeypatch.setattr(server.app, "render_vertical_with_captions", _fake_render_vertical)

    loop = asyncio.new_event_loop()
    state = server.app.JobState(loop=loop)
    state.project_dir = project_dir
    clip_id = stem
    clip = server.app.ClipArtifact(
        clip_id=clip_id,
        title="Highlight",
        channel="Creator",
        source_title="Sample Project",
        source_url="https://youtube.com/watch?v=abc",
        source_published_at=None,
        created_at=datetime.now(timezone.utc),
        duration_seconds=10.0,
        description="Existing",
        video_path=vertical_path,
        account="account-1",
        views=100,
        rating=9.0,
        quote="Amazing",
        reason="High energy",
        start_seconds=5.0,
        end_seconds=15.0,
        original_start_seconds=5.0,
        original_end_seconds=15.0,
    )
    state.clips[clip_id] = clip

    job_id = "job-test"
    with server.app._jobs_lock:
        server.app._jobs[job_id] = state

    client, _ = _make_authenticated_client()
    payload = {"start_seconds": 7.0, "end_seconds": 18.0}
    response = client.post(
        f"/api/jobs/{job_id}/clips/{clip_id}/adjust",
        json=payload,
    )
    assert response.status_code == 200
    body = response.json()
    assert body["duration_seconds"] == pytest.approx(11.0)
    assert "t=7" in body["description"].lower()
    assert body["start_seconds"] == pytest.approx(7.0)
    assert body["end_seconds"] == pytest.approx(18.0)
    assert body["original_start_seconds"] == pytest.approx(5.0)
    assert body["original_end_seconds"] == pytest.approx(15.0)
    assert body["has_adjustments"] is True
    assert body["preview_url"].endswith(f"/api/jobs/{job_id}/clips/{clip_id}/preview")

    preview_path = urlparse(body["preview_url"]).path
    preview_response = client.get(preview_path, params={"start": 7.0, "end": 18.0})
    assert preview_response.status_code == 200
    assert preview_response.content == b"preview-bytes"

    updated_clip = server.app._get_job(job_id).clips[clip_id]
    assert updated_clip.duration_seconds == pytest.approx(11.0)
    assert updated_clip.description == body["description"]
    assert updated_clip.start_seconds == pytest.approx(7.0)
    assert updated_clip.end_seconds == pytest.approx(18.0)
    assert updated_clip.original_start_seconds == pytest.approx(5.0)
    assert updated_clip.original_end_seconds == pytest.approx(15.0)

    metadata_path = vertical_path.with_suffix(".adjust.json")
    assert metadata_path.exists()
    metadata = json.loads(metadata_path.read_text())
    assert metadata["start_seconds"] == pytest.approx(7.0)
    assert metadata["end_seconds"] == pytest.approx(18.0)
    assert metadata["original_start_seconds"] == pytest.approx(5.0)
    assert metadata["original_end_seconds"] == pytest.approx(15.0)

    loop.close()
    with server.app._jobs_lock:
        server.app._jobs.clear()


def test_adjust_library_clip_updates_files(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setenv("OUT_ROOT", str(tmp_path))

    project_dir = tmp_path / "account-1" / "Sample_Project"
    shorts_dir = project_dir / "shorts"
    clips_dir = project_dir / "clips"
    subtitles_dir = project_dir / "subtitles"
    project_dir.mkdir(parents=True)
    shorts_dir.mkdir()
    clips_dir.mkdir()
    subtitles_dir.mkdir()

    video_path = project_dir / "Sample_Project.mp4"
    video_path.write_bytes(b"video")
    transcript_path = project_dir / "Sample_Project.txt"
    transcript_path.write_text("[0.00 -> 30.00] Hello world", encoding="utf-8")

    stem = "clip_5.00-15.00_r9.0"
    raw_clip_path = clips_dir / f"{stem}.mp4"
    raw_clip_path.write_bytes(b"raw")
    subtitle_path = subtitles_dir / f"{stem}.srt"
    subtitle_path.write_text(
        "1\n00:00:00,000 --> 00:00:02,000\nHi\n\n",
        encoding="utf-8",
    )
    vertical_path = shorts_dir / f"{stem}.mp4"
    vertical_path.write_bytes(b"vertical")
    description_path = shorts_dir / f"{stem}.txt"
    description_path.write_text(
        "Full video: https://youtube.com/watch?v=abc&t=5\nCredit: Creator\nMade by Atropos",
        encoding="utf-8",
    )

    def _fake_save_clip(source, output_path, *_, **__) -> bool:
        target = Path(output_path)
        target.parent.mkdir(parents=True, exist_ok=True)
        if target == raw_clip_path:
            target.write_bytes(b"raw-updated")
        else:
            target.write_bytes(b"preview-bytes")
        return True

    def _fake_render_vertical(*_, **__) -> Path:
        vertical_path.write_bytes(b"vertical-updated")
        return vertical_path

    monkeypatch.setattr(server.app, "save_clip", _fake_save_clip)
    monkeypatch.setattr(server.app, "render_vertical_with_captions", _fake_render_vertical)

    clips = server.library.list_account_clips_sync("account-1")
    assert len(clips) == 1
    clip_id = clips[0].clip_id

    client, _ = _make_authenticated_client()
    response = client.post(
        f"/api/accounts/account-1/clips/{clip_id}/adjust",
        json={"start_seconds": 6.0, "end_seconds": 20.0},
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["duration_seconds"] == pytest.approx(14.0)
    assert "t=6" in payload["description"].lower()
    assert payload["start_seconds"] == pytest.approx(6.0)
    assert payload["end_seconds"] == pytest.approx(20.0)
    assert payload["original_start_seconds"] == pytest.approx(5.0)
    assert payload["original_end_seconds"] == pytest.approx(15.0)
    assert payload["has_adjustments"] is True
    assert payload["preview_url"].endswith(f"/api/accounts/account-1/clips/{clip_id}/preview")

    preview_path = urlparse(payload["preview_url"]).path
    preview_response = client.get(preview_path, params={"start": 6.0, "end": 20.0})
    assert preview_response.status_code == 200
    assert preview_response.content == b"preview-bytes"

    refreshed_description = description_path.read_text(encoding="utf-8")
    assert "t=6" in refreshed_description.lower()

    metadata_path = vertical_path.with_suffix(".adjust.json")
    assert metadata_path.exists()
    metadata = json.loads(metadata_path.read_text())
    assert metadata["start_seconds"] == pytest.approx(6.0)
    assert metadata["end_seconds"] == pytest.approx(20.0)
    assert metadata["original_start_seconds"] == pytest.approx(5.0)
    assert metadata["original_end_seconds"] == pytest.approx(15.0)


def test_config_endpoint_lists_and_updates_values() -> None:
    client, _ = _make_authenticated_client()

    response = client.get("/api/config")
    assert response.status_code == 200
    payload = response.json()
    assert isinstance(payload, list)

    names = {item["name"] for item in payload}
    assert "CAPTION_FONT_SCALE" in names
    assert "MIN_DURATION_SECONDS" in names

    original_font_scale = pipeline_config.CAPTION_FONT_SCALE
    original_min_duration = pipeline_config.MIN_DURATION_SECONDS
    original_candidate_min = pipeline_config.CANDIDATE_SELECTION.min_duration_seconds

    try:
        update_response = client.patch(
            "/api/config",
            json={"values": {"CAPTION_FONT_SCALE": 3.5}},
        )
        assert update_response.status_code == 200
        assert pipeline_config.CAPTION_FONT_SCALE == 3.5
        updated_payload = update_response.json()
        assert any(
            entry["name"] == "CAPTION_FONT_SCALE" and entry["value"] == 3.5
            for entry in updated_payload
        )

        min_duration_response = client.patch(
            "/api/config",
            json={"values": {"MIN_DURATION_SECONDS": 11}},
        )
        assert min_duration_response.status_code == 200
        assert pipeline_config.MIN_DURATION_SECONDS == 11
        assert pipeline_config.CANDIDATE_SELECTION.min_duration_seconds == 11
    finally:
        client.patch(
            "/api/config",
            json={
                "values": {
                    "CAPTION_FONT_SCALE": original_font_scale,
                    "MIN_DURATION_SECONDS": original_min_duration,
                }
            },
        )
        pipeline_config.CAPTION_FONT_SCALE = original_font_scale
        pipeline_config.MIN_DURATION_SECONDS = original_min_duration
        pipeline_config.CANDIDATE_SELECTION.min_duration_seconds = original_candidate_min
