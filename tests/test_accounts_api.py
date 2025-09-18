"""Tests for the account authentication management endpoints."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from server.app import app
from server.auth import accounts


@pytest.fixture()
def account_client(tmp_path: Path):
    """Provide a test client backed by a temporary tokens directory."""

    original_store = accounts._store  # type: ignore[attr-defined]
    store = accounts.AccountStore(tmp_path)
    accounts.set_account_store(store)
    client = TestClient(app)
    try:
        yield client, tmp_path
    finally:
        accounts.set_account_store(original_store)


def test_account_lifecycle(account_client) -> None:
    client, tokens_dir = account_client

    response = client.get("/api/accounts")
    assert response.status_code == 200
    assert response.json() == []

    create_payload = {"displayName": "Creator Hub"}
    response = client.post("/api/accounts", json=create_payload)
    assert response.status_code == 201
    account = response.json()
    assert account["displayName"] == "Creator Hub"
    account_id = account["id"]

    platform_payload = {"platform": "youtube", "credentials": {"accessToken": "abc"}}
    response = client.post(f"/api/accounts/{account_id}/platforms", json=platform_payload)
    assert response.status_code == 200
    updated = response.json()
    assert len(updated["platforms"]) == 1
    platform = updated["platforms"][0]
    assert platform["platform"] == "youtube"
    assert platform["connected"] is True
    assert platform["status"] == "active"

    token_file = tokens_dir / account_id / "youtube.json"
    assert token_file.exists()

    response = client.get("/api/auth/ping")
    assert response.status_code == 200
    ping = response.json()
    assert ping["accounts"] == 1
    assert ping["totalPlatforms"] == 1
    assert ping["connectedPlatforms"] == 1
    assert ping["status"] == "ok"

    duplicate_response = client.post(
        f"/api/accounts/{account_id}/platforms", json={"platform": "youtube"}
    )
    assert duplicate_response.status_code == 409


def test_ping_reports_missing_tokens(account_client) -> None:
    client, tokens_dir = account_client

    response = client.post("/api/accounts", json={"displayName": "Studio"})
    assert response.status_code == 201
    account_id = response.json()["id"]

    response = client.post(
        f"/api/accounts/{account_id}/platforms",
        json={"platform": "tiktok", "credentials": {}},
    )
    assert response.status_code == 200

    token_file = tokens_dir / account_id / "tiktok.json"
    assert token_file.exists()

    token_file.unlink()

    response = client.get("/api/auth/ping")
    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "degraded"
    assert payload["connectedPlatforms"] == 0
    assert payload["totalPlatforms"] == 1


def test_discovers_preexisting_token_files(account_client) -> None:
    client, tokens_dir = account_client

    response = client.post("/api/accounts", json={"displayName": "Funny"})
    assert response.status_code == 201
    account_id = response.json()["id"]

    account_dir = tokens_dir / account_id
    account_dir.mkdir(parents=True, exist_ok=True)
    (account_dir / "tiktok.json").write_text(
        json.dumps({"accessToken": "abc"}), encoding="utf-8"
    )
    (account_dir / "instagram.json").write_text(
        json.dumps({"session": "value"}), encoding="utf-8"
    )

    response = client.get("/api/accounts")
    assert response.status_code == 200
    accounts = response.json()
    assert len(accounts) == 1
    platforms = {item["platform"]: item for item in accounts[0]["platforms"]}
    assert set(platforms) == {"tiktok", "instagram"}
    assert platforms["tiktok"]["connected"] is True
    assert platforms["instagram"]["connected"] is True
    assert platforms["instagram"]["tokenPath"].endswith("instagram.json")


def test_invalid_token_file_marks_platform_disconnected(account_client) -> None:
    client, tokens_dir = account_client

    response = client.post("/api/accounts", json={"displayName": "News"})
    assert response.status_code == 201
    account_id = response.json()["id"]

    account_dir = tokens_dir / account_id
    account_dir.mkdir(parents=True, exist_ok=True)
    (account_dir / "youtube.json").write_text("{not json", encoding="utf-8")

    response = client.get("/api/accounts")
    assert response.status_code == 200
    accounts = response.json()
    youtube = {item["platform"]: item for item in accounts[0]["platforms"]}["youtube"]
    assert youtube["connected"] is False
    assert youtube["status"] == "disconnected"
    assert youtube["tokenPath"].endswith("youtube.json")

    ping = client.get("/api/auth/ping")
    assert ping.status_code == 200
    payload = ping.json()
    assert payload["status"] == "degraded"
    assert payload["connectedPlatforms"] == 0
    assert payload["totalPlatforms"] == 1
