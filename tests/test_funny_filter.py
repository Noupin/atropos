from server.steps.candidates.funny import find_funny_timestamps


def test_funny_rejects_nonfunny(monkeypatch, tmp_path):
    transcript = tmp_path / "t.txt"
    transcript.write_text(
        "[0.00 -> 3.00] This is a serious statement about finances.\n",
        encoding="utf-8",
    )

    def fake_ollama_call_json(*, model, prompt, options=None, timeout=120):
        if "TRANSCRIPT" in prompt:
            return [{"start": 0.0, "end": 3.0, "rating": 9, "reason": "", "quote": ""}]
        return [{"match": False}]

    monkeypatch.setattr(
        "server.steps.candidates.ollama_call_json", fake_ollama_call_json
    )

    results = find_funny_timestamps(transcript, min_rating=8.0, min_word_count=1)
    assert results == []
