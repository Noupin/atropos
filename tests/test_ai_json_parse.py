from __future__ import annotations

import json

from server.helpers import ai


def test_ollama_call_json_extracts_list_from_dict(monkeypatch) -> None:
    raw = json.dumps({"segments": [{"start": 0.0, "end": 1.0}]})

    def fake_generate(*args, **kwargs):
        return raw

    monkeypatch.setattr(ai, "ollama_generate", fake_generate)

    result = ai.ollama_call_json(model="m", prompt="p")
    assert result == [{"start": 0.0, "end": 1.0}]


def test_lmstudio_call_json_extracts_list_from_dict(monkeypatch) -> None:
    raw = json.dumps({"dialog": [{"start": 0.0, "end": 1.0}]})

    def fake_generate(*args, **kwargs):
        return raw

    monkeypatch.setattr(ai, "lmstudio_generate", fake_generate)

    result = ai.lmstudio_call_json(model="m", prompt="p")
    assert result == [{"start": 0.0, "end": 1.0}]


def test_ollama_generate_handles_dict_response(monkeypatch) -> None:
    class DummyResp:
        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict:
            return {"response": {"foo": [1, 2]}}

    def fake_post(*args, **kwargs):
        return DummyResp()

    monkeypatch.setattr(ai.requests, "post", fake_post)

    out = ai.ollama_generate(model="m", prompt="p")
    assert out == json.dumps({"foo": [1, 2]})

