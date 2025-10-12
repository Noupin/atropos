"""Tests for the clip library API endpoints."""

from __future__ import annotations

import base64
import json
import os
from datetime import datetime, timezone
from pathlib import Path

from fastapi.testclient import TestClient

import server.app
from server.app import app


def _create_clip_structure(base: Path) -> tuple[str, Path]:
    account_id = "account-one"
    project_dir = base / account_id / "Amazing_Project_20240101"
    shorts_dir = project_dir / "shorts"
    shorts_dir.mkdir(parents=True)

    source_video = project_dir / f"{project_dir.name}.mp4"
    source_video.parent.mkdir(parents=True, exist_ok=True)
    source_video.write_bytes(b"source-video")

    clip_filename = "clip_0.00-12.50_r9.0.mp4"
    clip_path = shorts_dir / clip_filename
    clip_path.write_bytes(b"fake-mp4-data")

    description = (
        "Full video: https://example.com/watch?v=abc123&t=15\n"
        "Credit: Example Channel\n"
        "Some description text.\n"
    )
    clip_path.with_suffix(".txt").write_text(description, encoding="utf-8")

    candidates_path = project_dir / "candidates.json"
    candidates_path.write_text(
        json.dumps(
          [
              {
                  "start": 0.0,
                  "end": 12.5,
                  "quote": "A memorable quote",
                  "reason": "It was exciting",
                  "rating": 9.0,
              }
          ]
        ),
        encoding="utf-8",
    )

    timestamp = datetime(2024, 3, 4, tzinfo=timezone.utc).timestamp()
    os.utime(clip_path, (timestamp, timestamp))

    return account_id, clip_path


def test_list_account_clips(monkeypatch, tmp_path):
    out_root = tmp_path / "out"
    monkeypatch.setenv("OUT_ROOT", str(out_root))
    account_id, clip_path = _create_clip_structure(out_root)

    client = TestClient(app)
    response = client.get(f"/api/accounts/{account_id}/clips")

    assert response.status_code == 200
    payload = response.json()
    assert isinstance(payload, dict)
    assert payload["total_count"] == 1
    assert payload["next_cursor"] is None
    assert isinstance(payload["items"], list)
    assert len(payload["items"]) == 1
    clip = payload["items"][0]
    assert clip["title"] == "Amazing Project"
    assert clip["account"] == account_id
    assert clip["quote"] == "A memorable quote"
    assert clip["reason"] == "It was exciting"
    assert clip["rating"] == 9.0
    assert clip["channel"] == "Example Channel"
    assert clip["timestamp_seconds"] == 15
    assert clip["timestamp_url"].endswith("t=15")
    assert clip["source_url"] == "https://example.com/watch?v=abc123"
    assert clip["source_title"] == "Amazing Project"
    assert clip["description"].startswith("Full video:")
    assert clip["start_seconds"] == 0.0
    assert clip["end_seconds"] == 12.5
    assert clip["original_start_seconds"] == 0.0
    assert clip["original_end_seconds"] == 12.5
    assert clip["has_adjustments"] is False
    project_relative = clip_path.parent.parent.relative_to(out_root)
    expected_video_id = base64.urlsafe_b64encode(project_relative.as_posix().encode("utf-8")).decode("ascii").rstrip("=")
    assert clip["video_id"] == expected_video_id
    assert clip["video_title"] == "Amazing Project"
    assert clip["playback_url"].endswith(f"/api/accounts/{account_id}/clips/{clip['id']}/video")
    assert clip["preview_url"].endswith(f"/api/accounts/{account_id}/clips/{clip['id']}/preview")
    assert clip["thumbnail_url"].endswith(
        f"/api/accounts/{account_id}/clips/{clip['id']}/thumbnail"
    )


def test_list_account_clips_pagination(monkeypatch, tmp_path):
    out_root = tmp_path / "out"
    monkeypatch.setenv("OUT_ROOT", str(out_root))
    account_id, clip_path = _create_clip_structure(out_root)

    base_description = clip_path.with_suffix(".txt").read_text(encoding="utf-8")
    base_timestamp = clip_path.stat().st_mtime

    second_clip_path = clip_path.parent / "clip_12.00-24.00.mp4"
    second_clip_path.write_bytes(b"another-fake-mp4")
    second_clip_path.with_suffix(".txt").write_text(base_description, encoding="utf-8")
    os.utime(second_clip_path, (base_timestamp + 60, base_timestamp + 60))

    client = TestClient(app)
    first_page = client.get(
        f"/api/accounts/{account_id}/clips",
        params={"limit": 1},
    )

    assert first_page.status_code == 200
    payload = first_page.json()
    assert payload["total_count"] == 2
    assert len(payload["items"]) == 1
    first_clip_id = payload["items"][0]["id"]
    cursor = payload["next_cursor"]
    assert cursor is not None

    second_page = client.get(
        f"/api/accounts/{account_id}/clips",
        params={"limit": 1, "cursor": cursor},
    )

    assert second_page.status_code == 200
    second_payload = second_page.json()
    assert len(second_payload["items"]) == 1
    assert second_payload["items"][0]["id"] != first_clip_id
    assert second_payload["total_count"] == 2
    assert second_payload["next_cursor"] is None


def test_get_account_clip(monkeypatch, tmp_path):
    out_root = tmp_path / "out"
    monkeypatch.setenv("OUT_ROOT", str(out_root))
    account_id, _ = _create_clip_structure(out_root)

    client = TestClient(app)
    listing = client.get(f"/api/accounts/{account_id}/clips")
    clip_id = listing.json()["items"][0]["id"]

    detail = client.get(f"/api/accounts/{account_id}/clips/{clip_id}")
    assert detail.status_code == 200
    payload = detail.json()
    assert payload["id"] == clip_id
    assert payload["title"] == "Amazing Project"
    assert payload["playback_url"].endswith(f"/api/accounts/{account_id}/clips/{clip_id}/video")
    assert payload["preview_url"].endswith(f"/api/accounts/{account_id}/clips/{clip_id}/preview")
    assert payload["thumbnail_url"].endswith(
        f"/api/accounts/{account_id}/clips/{clip_id}/thumbnail"
    )

    missing = client.get(f"/api/accounts/{account_id}/clips/unknown")
    assert missing.status_code == 404


def test_get_account_clip_video(monkeypatch, tmp_path):
    out_root = tmp_path / "out"
    monkeypatch.setenv("OUT_ROOT", str(out_root))
    account_id, clip_path = _create_clip_structure(out_root)

    relative = clip_path.relative_to(out_root)
    clip_id = base64.urlsafe_b64encode(relative.as_posix().encode("utf-8")).decode("ascii").rstrip("=")

    client = TestClient(app)
    response = client.get(f"/api/accounts/{account_id}/clips/{clip_id}/video")

    assert response.status_code == 200
    assert response.headers.get("content-type") == "video/mp4"
    assert response.content == clip_path.read_bytes()

    missing = client.get(f"/api/accounts/{account_id}/clips/unknown/video")
    assert missing.status_code == 404


def test_get_account_clip_preview(monkeypatch, tmp_path):
    out_root = tmp_path / "out"
    monkeypatch.setenv("OUT_ROOT", str(out_root))
    account_id, clip_path = _create_clip_structure(out_root)

    relative = clip_path.relative_to(out_root)
    clip_id = base64.urlsafe_b64encode(relative.as_posix().encode("utf-8")).decode("ascii").rstrip("=")

    def _fake_save_clip(source, output_path, *_, **__) -> bool:
        target = Path(output_path)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(b"preview-bytes")
        return True

    monkeypatch.setattr(server.app, "save_clip", _fake_save_clip)

    client = TestClient(app)
    response = client.get(
        f"/api/accounts/{account_id}/clips/{clip_id}/preview",
        params={"start": 1.0, "end": 3.0},
    )

    assert response.status_code == 200
    assert response.headers.get("content-type") == "video/mp4"
    assert response.content == b"preview-bytes"

    missing = client.get(f"/api/accounts/{account_id}/clips/unknown/preview")
    assert missing.status_code == 404


def test_get_account_clip_thumbnail(monkeypatch, tmp_path):
    out_root = tmp_path / "out"
    monkeypatch.setenv("OUT_ROOT", str(out_root))
    account_id, clip_path = _create_clip_structure(out_root)

    relative = clip_path.relative_to(out_root)
    clip_id = base64.urlsafe_b64encode(relative.as_posix().encode("utf-8")).decode("ascii").rstrip("=")

    def _fake_run(command, *args, **kwargs):
        output_path = Path(command[-1])
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_bytes(b"thumbnail-bytes")
        class _Result:
            returncode = 0

        return _Result()

    monkeypatch.setattr(server.app.subprocess, "run", _fake_run)

    client = TestClient(app)
    response = client.get(f"/api/accounts/{account_id}/clips/{clip_id}/thumbnail")

    assert response.status_code == 200
    assert response.headers.get("content-type") == "image/jpeg"
    assert response.headers.get("cache-control") == "no-store"
    assert response.content == b"thumbnail-bytes"

    missing = client.get(f"/api/accounts/{account_id}/clips/unknown/thumbnail")
    assert missing.status_code == 404
