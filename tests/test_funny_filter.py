from __future__ import annotations

from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import server.steps.candidates as cand_pkg
from server.steps.candidates.funny import find_funny_timestamps


def test_non_funny_segments_rejected(tmp_path: Path, monkeypatch) -> None:
    transcript = tmp_path / "t.txt"
    transcript.write_text("[0.00 -> 3.00] This is a very serious discussion about science.\n", encoding="utf-8")

    def fake_ollama_call_json(model, prompt, options=None, timeout=None):
        if not hasattr(fake_ollama_call_json, "calls"):
            fake_ollama_call_json.calls = 0
        fake_ollama_call_json.calls += 1
        if fake_ollama_call_json.calls == 1:
            return [
                {
                    "start": 0.0,
                    "end": 3.0,
                    "rating": 9,
                    "reason": "pretend",
                    "quote": "serious discussion",
                }
            ]
        return {"match": False}

    monkeypatch.setattr(cand_pkg, "ollama_call_json", fake_ollama_call_json)

    result = find_funny_timestamps(str(transcript), min_words=1)
    assert result == []

