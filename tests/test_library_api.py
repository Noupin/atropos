"""Tests for the clip library API endpoints."""

from __future__ import annotations

import base64
import json
import os
from datetime import datetime, timezone
from pathlib import Path

from fastapi.testclient import TestClient

from server.app import app


def _create_clip_structure(base: Path) -> tuple[str, Path]:
    account_id = "account-one"
    project_dir = base / account_id / "Amazing_Project_20240101"
    shorts_dir = project_dir / "shorts"
    shorts_dir.mkdir(parents=True)

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
    assert isinstance(payload, list)
    assert len(payload) == 1
    clip = payload[0]
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
    assert clip["playback_url"].endswith(f"/api/accounts/{account_id}/clips/{clip['id']}/video")


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
