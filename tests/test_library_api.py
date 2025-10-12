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


def _create_multiple_clips(base: Path, account_id: str, total: int) -> None:
    for index in range(total):
        project_dir = base / account_id / f"Project_{index:02d}"
        shorts_dir = project_dir / "shorts"
        shorts_dir.mkdir(parents=True, exist_ok=True)

        clip_filename = f"clip_{index}.00-{index + 5}.00_r8.0.mp4"
        clip_path = shorts_dir / clip_filename
        clip_path.write_bytes(b"fake-mp4-data")

        description = (
            "Full video: https://example.com/watch?v=abc123\n"
            "Credit: Example Channel\n"
            f"Clip {index}\n"
        )
        clip_path.with_suffix(".txt").write_text(description, encoding="utf-8")

        candidates_path = project_dir / "candidates.json"
        candidates_path.write_text(
            json.dumps(
                [
                    {
                        "start": float(index),
                        "end": float(index + 5),
                        "quote": f"Quote {index}",
                        "reason": f"Reason {index}",
                        "rating": 8.0,
                    }
                ]
            ),
            encoding="utf-8",
        )

        timestamp = datetime(2024, 1, 1, tzinfo=timezone.utc).timestamp() + index
        os.utime(clip_path, (timestamp, timestamp))


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
    assert clip["thumbnail_url"].endswith(f"/api/accounts/{account_id}/clips/{clip['id']}/thumbnail")


def test_paginated_clips_endpoint(monkeypatch, tmp_path):
    out_root = tmp_path / "out"
    monkeypatch.setenv("OUT_ROOT", str(out_root))
    account_id = "account-paged"
    _create_multiple_clips(out_root, account_id, total=5)

    client = TestClient(app)

    first_page = client.get("/api/clips", params={"accountId": account_id, "limit": 2})
    assert first_page.status_code == 200
    first_payload = first_page.json()
    assert set(first_payload.keys()) == {"clips", "nextCursor", "totalClips", "projects"}
    assert len(first_payload["clips"]) == 2
    assert isinstance(first_payload["nextCursor"], str)
    assert first_payload["totalClips"] == 5
    assert isinstance(first_payload["projects"], list)
    assert first_payload["projects"]
    assert all("id" in project and "totalClips" in project for project in first_payload["projects"])

    second_page = client.get(
        "/api/clips",
        params={"accountId": account_id, "limit": 2, "cursor": first_payload["nextCursor"]},
    )
    assert second_page.status_code == 200
    second_payload = second_page.json()
    assert len(second_payload["clips"]) == 2
    assert isinstance(second_payload.get("nextCursor"), str)
    assert second_payload["totalClips"] == 5

    third_page = client.get(
        "/api/clips",
        params={"accountId": account_id, "limit": 2, "cursor": second_payload["nextCursor"]},
    )
    assert third_page.status_code == 200
    third_payload = third_page.json()
    assert len(third_payload["clips"]) == 1
    assert third_payload["nextCursor"] is None
    assert third_payload["totalClips"] == 5

    bad_cursor = client.get(
        "/api/clips",
        params={"accountId": account_id, "limit": 2, "cursor": "not-a-valid-cursor"},
    )
    assert bad_cursor.status_code == 400


def test_get_account_clip(monkeypatch, tmp_path):
    out_root = tmp_path / "out"
    monkeypatch.setenv("OUT_ROOT", str(out_root))
    account_id, _ = _create_clip_structure(out_root)

    client = TestClient(app)
    listing = client.get(f"/api/accounts/{account_id}/clips")
    clip_id = listing.json()[0]["id"]

    detail = client.get(f"/api/accounts/{account_id}/clips/{clip_id}")
    assert detail.status_code == 200
    payload = detail.json()
    assert payload["id"] == clip_id
    assert payload["title"] == "Amazing Project"
    assert payload["playback_url"].endswith(f"/api/accounts/{account_id}/clips/{clip_id}/video")
    assert payload["preview_url"].endswith(f"/api/accounts/{account_id}/clips/{clip_id}/preview")

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

    def _fake_generate_thumbnail(*_, **__):
        target = clip_path.parent / "thumbnails" / "thumb.jpg"
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(b"thumbnail-bytes")
        return target

    monkeypatch.setattr(server.app, "_generate_clip_thumbnail", _fake_generate_thumbnail)

    client = TestClient(app)
    response = client.get(f"/api/accounts/{account_id}/clips/{clip_id}/thumbnail")

    assert response.status_code == 200
    assert response.headers.get("content-type") == "image/jpeg"
    assert response.content == b"thumbnail-bytes"

    missing = client.get(f"/api/accounts/{account_id}/clips/unknown/thumbnail")
    assert missing.status_code == 404
