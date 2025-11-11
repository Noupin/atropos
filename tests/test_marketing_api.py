"""Tests for the public marketing API endpoints."""

from __future__ import annotations

import importlib
import json
import sys
from pathlib import Path

import pytest

pytest.importorskip("flask")


@pytest.fixture()
def marketing_app(tmp_path, monkeypatch):
    data_dir = tmp_path / "data"
    monkeypatch.setenv("DATA_DIR", str(data_dir))
    monkeypatch.setenv("SUBSCRIBERS_FILE", str(data_dir / "subscribers.json"))
    monkeypatch.setenv("UNSUB_TOKENS_FILE", str(data_dir / "tokens.json"))
    monkeypatch.setenv("PUBLIC_BASE_URL", "https://example.com")

    repo_root = Path(__file__).resolve().parents[1]
    repo_root_str = str(repo_root)
    path_added = False
    if repo_root_str not in sys.path:
        sys.path.insert(0, repo_root_str)
        path_added = True

    sys.modules.pop("api.app", None)
    module = importlib.import_module("api.app")
    monkeypatch.setattr(module, "send_welcome_email", lambda *args, **kwargs: None)

    yield module

    sys.modules.pop("api.app", None)
    if path_added and sys.path and sys.path[0] == repo_root_str:
        sys.path.pop(0)


def _read_json(path: Path) -> dict | list:
    data = path.read_text(encoding="utf-8")
    return json.loads(data) if data else {}


def test_subscribe_and_unsubscribe_support_api_prefix(marketing_app):
    client = marketing_app.app.test_client()

    first_email = "api@example.com"
    response = client.post("/api/subscribe", json={"email": first_email})
    assert response.status_code == 200
    payload = response.get_json()
    assert payload["ok"] is True

    second_email = "plain@example.com"
    response_plain = client.post("/subscribe", json={"email": second_email})
    assert response_plain.status_code == 200
    payload_plain = response_plain.get_json()
    assert payload_plain["ok"] is True

    tokens_path = Path(marketing_app.settings.storage.unsub_tokens_file)
    tokens = _read_json(tokens_path)
    assert isinstance(tokens, dict)
    assert len(tokens) == 2

    first_token = next(iter(tokens))
    unsubscribe_api = client.get(f"/api/unsubscribe?token={first_token}")
    assert unsubscribe_api.status_code == 200
    assert unsubscribe_api.get_json()["ok"] is True

    tokens_after_api = _read_json(tokens_path)
    assert len(tokens_after_api) == 1

    remaining_token = next(iter(tokens_after_api))
    unsubscribe_plain = client.get(f"/unsubscribe?token={remaining_token}")
    assert unsubscribe_plain.status_code == 200
    assert unsubscribe_plain.get_json()["ok"] is True

    tokens_after_plain = _read_json(tokens_path)
    assert tokens_after_plain == {}

    subscribers_path = Path(marketing_app.settings.storage.subscribers_file)
    subscribers = _read_json(subscribers_path)
    assert subscribers == []
