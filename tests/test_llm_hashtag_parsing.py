from helpers import ai


def test_ollama_call_json_handles_smart_quotes(monkeypatch):
    sample = '[“Nick”, “Andy”, “chicken”]'

    def fake_generate(*args, **kwargs):
        return sample

    monkeypatch.setattr(ai, "ollama_generate", fake_generate)

    result = ai.ollama_call_json(model="m", prompt="p")
    assert result == ["Nick", "Andy", "chicken"]


def test_ollama_call_json_handles_code_fence(monkeypatch):
    sample = '```json\n["Nick", "Andy"]\n```'

    def fake_generate(*args, **kwargs):
        return sample

    monkeypatch.setattr(ai, "ollama_generate", fake_generate)

    result = ai.ollama_call_json(model="m", prompt="p")
    assert result == ["Nick", "Andy"]

