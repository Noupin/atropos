"""Tests for the account authentication management endpoints."""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, Iterable, Tuple

import pytest
from fastapi import HTTPException, status
from fastapi.testclient import TestClient

from server.app import app
from server.auth import accounts


@dataclass
class StubAuthenticator:
    """Record authentication attempts and create token files for tests."""

    platform: accounts.SupportedPlatform
    calls: list[Tuple[Path, Dict[str, object]]] = field(default_factory=list)
    should_fail: bool = False

    def __call__(self, account_dir: Path, credentials: Dict[str, object]) -> None:
        self.calls.append((account_dir, credentials))
        if self.should_fail:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"{self.platform} authentication failed",
            )
        account_dir.mkdir(parents=True, exist_ok=True)
        token_path = account_dir / accounts.PLATFORM_TOKEN_FILES[self.platform]
        token_path.write_text(
            json.dumps({"token": self.platform, "credentials": credentials}),
            encoding="utf-8",
        )


def _create_stub_authenticators() -> Dict[accounts.SupportedPlatform, StubAuthenticator]:
    return {platform: StubAuthenticator(platform) for platform in accounts.SUPPORTED_PLATFORMS}


@pytest.fixture()
def account_client(tmp_path: Path):
    """Provide a test client backed by a temporary tokens directory."""

    original_store = accounts._store  # type: ignore[attr-defined]
    authenticators = _create_stub_authenticators()
    store = accounts.AccountStore(tmp_path, auth_handlers=authenticators)
    accounts.set_account_store(store)
    client = TestClient(app)
    try:
        yield client, tmp_path, authenticators
    finally:
        accounts.set_account_store(original_store)


def _list_platforms(account_payload: Dict[str, object]) -> Dict[str, Dict[str, object]]:
    platforms = account_payload.get("platforms")
    assert isinstance(platforms, Iterable)
    return {item["platform"]: item for item in platforms}


def test_account_lifecycle(account_client) -> None:
    client, tokens_dir, authenticators = account_client

    response = client.get("/api/accounts")
    assert response.status_code == 200
    assert response.json() == []

    create_payload = {"displayName": "Creator Hub"}
    response = client.post("/api/accounts", json=create_payload)
    assert response.status_code == 201
    account = response.json()
    assert account["displayName"] == "Creator Hub"
    assert account["active"] is True
    account_id = account["id"]

    platform_payload = {"platform": "youtube", "credentials": {"accessToken": "abc"}}
    response = client.post(f"/api/accounts/{account_id}/platforms", json=platform_payload)
    assert response.status_code == 200
    updated = response.json()
    platforms = _list_platforms(updated)
    youtube = platforms["youtube"]
    assert youtube["connected"] is True
    assert youtube["status"] == "active"
    assert youtube["active"] is True
    assert updated["active"] is True

    token_file = tokens_dir / account_id / "youtube.json"
    assert token_file.exists()
    assert authenticators["youtube"].calls[0][1] == {"accessToken": "abc"}

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
    client, tokens_dir, _authenticators = account_client

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
    client, tokens_dir, _authenticators = account_client

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
    payload = response.json()
    assert len(payload) == 1
    account = payload[0]
    assert account["active"] is True
    platforms = _list_platforms(account)
    assert set(platforms) == {"tiktok", "instagram"}
    assert platforms["tiktok"]["connected"] is True
    assert platforms["instagram"]["connected"] is True
    assert platforms["instagram"]["tokenPath"].endswith("instagram.json")


def test_invalid_token_file_marks_platform_disconnected(account_client) -> None:
    client, tokens_dir, _authenticators = account_client

    response = client.post("/api/accounts", json={"displayName": "News"})
    assert response.status_code == 201
    account_id = response.json()["id"]

    account_dir = tokens_dir / account_id
    account_dir.mkdir(parents=True, exist_ok=True)
    (account_dir / "youtube.json").write_text("{not json", encoding="utf-8")

    response = client.get("/api/accounts")
    assert response.status_code == 200
    payload = response.json()
    youtube = _list_platforms(payload[0])["youtube"]
    assert youtube["connected"] is False
    assert youtube["status"] == "disconnected"
    assert youtube["tokenPath"].endswith("youtube.json")

    ping = client.get("/api/auth/ping")
    assert ping.status_code == 200
    body = ping.json()
    assert body["status"] == "degraded"
    assert body["connectedPlatforms"] == 0
    assert body["totalPlatforms"] == 1


def test_can_toggle_account_active_state(account_client) -> None:
    client, tokens_dir, _authenticators = account_client

    response = client.post("/api/accounts", json={"displayName": "Creator"})
    account_id = response.json()["id"]
    client.post(
        f"/api/accounts/{account_id}/platforms",
        json={"platform": "youtube", "credentials": {}},
    )

    response = client.patch(f"/api/accounts/{account_id}", json={"active": False})
    assert response.status_code == 200
    payload = response.json()
    assert payload["active"] is False
    youtube = _list_platforms(payload)["youtube"]
    assert youtube["status"] == "disabled"
    assert youtube["connected"] is False

    ping = client.get("/api/auth/ping")
    assert ping.status_code == 200
    assert ping.json()["totalPlatforms"] == 0

    response = client.patch(f"/api/accounts/{account_id}", json={"active": True})
    assert response.status_code == 200
    payload = response.json()
    assert payload["active"] is True
    youtube = _list_platforms(payload)["youtube"]
    assert youtube["status"] == "active"


def test_can_toggle_platform_active_state(account_client) -> None:
    client, _tokens_dir, _authenticators = account_client

    response = client.post("/api/accounts", json={"displayName": "Creator"})
    account_id = response.json()["id"]
    client.post(
        f"/api/accounts/{account_id}/platforms",
        json={"platform": "tiktok", "credentials": {}},
    )

    response = client.patch(
        f"/api/accounts/{account_id}/platforms/tiktok",
        json={"active": False},
    )
    assert response.status_code == 200
    payload = response.json()
    tiktok = _list_platforms(payload)["tiktok"]
    assert tiktok["active"] is False
    assert tiktok["status"] == "disabled"
    assert tiktok["connected"] is False

    ping = client.get("/api/auth/ping")
    assert ping.status_code == 200
    assert ping.json()["totalPlatforms"] == 0

    response = client.patch(
        f"/api/accounts/{account_id}/platforms/tiktok",
        json={"active": True},
    )
    assert response.status_code == 200
    payload = response.json()
    tiktok = _list_platforms(payload)["tiktok"]
    assert tiktok["active"] is True
    assert tiktok["status"] == "active"


def test_can_remove_platform_and_account(account_client) -> None:
    client, tokens_dir, _authenticators = account_client

    response = client.post("/api/accounts", json={"displayName": "Creator"})
    account_id = response.json()["id"]
    client.post(
        f"/api/accounts/{account_id}/platforms",
        json={"platform": "instagram", "credentials": {"username": "user", "password": "pass"}},
    )

    response = client.delete(f"/api/accounts/{account_id}/platforms/instagram")
    assert response.status_code == 200
    payload = response.json()
    assert payload["platforms"] == []

    account_dir = tokens_dir / account_id
    assert not (account_dir / "instagram_session.json").exists()

    response = client.delete(f"/api/accounts/{account_id}")
    assert response.status_code == 204
    assert not account_dir.exists()


def test_failed_authentication_rolls_back_metadata(account_client) -> None:
    client, tokens_dir, authenticators = account_client

    authenticators["instagram"].should_fail = True

    response = client.post("/api/accounts", json={"displayName": "Creator"})
    account_id = response.json()["id"]
    response = client.post(
        f"/api/accounts/{account_id}/platforms",
        json={"platform": "instagram", "credentials": {"username": "user", "password": "pass"}},
    )
    assert response.status_code == 400

    account_dir = tokens_dir / account_id
    assert not account_dir.joinpath("instagram_session.json").exists()

    response = client.get(f"/api/accounts/{account_id}")
    assert response.status_code == 200
    payload = response.json()
    assert payload["platforms"] == []
