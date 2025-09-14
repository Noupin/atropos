from __future__ import annotations

import json

import pytest

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


def test_lmstudio_call_json_salvages_tokens(monkeypatch) -> None:
    raw = '["Adam",""Eve"],""Ricot"],""dome"],""volcanic"]'

    def fake_generate(*args, **kwargs):
        return raw

    monkeypatch.setattr(ai, "lmstudio_generate", fake_generate)

    out = ai.lmstudio_call_json(model="m", prompt="p")
    assert [d["text"] for d in out] == ["Adam", "Eve", "Ricot", "dome", "volcanic"]


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


def test_ollama_call_json_strips_control_chars(monkeypatch) -> None:
    raw = '["alpha", "br\navo", "char\ttlie"]'

    def fake_generate(*args, **kwargs):
        return raw

    monkeypatch.setattr(ai, "ollama_generate", fake_generate)

    result = ai.ollama_call_json(model="m", prompt="p")
    assert result == ["alpha", "bravo", "chartlie"]


def _round_trip(raw: str):
    coerced = ai.coerce_json_array(raw, ai.DEFAULT_JSON_EXTRACT)
    return json.loads(coerced)


def test_coerce_json_array_valid() -> None:
    raw = '[{"start":1.0,"end":2.0,"text":"hi"}]'
    assert _round_trip(raw) == [{"start": 1.0, "end": 2.0, "text": "hi"}]


def test_coerce_json_array_code_fence() -> None:
    raw = "Here you go:\n```json\n[{\"a\":1,},]\n```\nThanks!"
    assert _round_trip(raw) == [{"a": 1}]


def test_coerce_json_array_single_quotes() -> None:
    raw = "['x', 'y',]"
    assert _round_trip(raw) == ["x", "y"]


def test_coerce_json_array_longest_match() -> None:
    raw = 'junk [1] more junk [{"k":1},{"k":2}] tail'
    assert _round_trip(raw) == [{"k": 1}, {"k": 2}]


def test_coerce_json_array_nan_and_infinity() -> None:
    raw = '[{"v":NaN},{"v":Infinity}]'
    assert _round_trip(raw) == [{"v": None}, {"v": None}]


def test_coerce_json_array_no_array() -> None:
    with pytest.raises(ValueError):
        ai.coerce_json_array("done", ai.DEFAULT_JSON_EXTRACT)

