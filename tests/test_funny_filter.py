from __future__ import annotations

from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "server"))

import server.steps.candidates as cand_pkg
from server.steps.candidates.funny import find_funny_timestamps


def test_non_funny_segments_rejected(tmp_path: Path, monkeypatch) -> None:
    transcript = tmp_path / "t.txt"
    transcript.write_text("[0.00 -> 3.00] This is a very serious discussion about science.\n", encoding="utf-8")

    def fake_local_llm_call_json(model, prompt, options=None, timeout=None):
        if not hasattr(fake_local_llm_call_json, "calls"):
            fake_local_llm_call_json.calls = 0
        fake_local_llm_call_json.calls += 1
        if fake_local_llm_call_json.calls == 1:
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

    monkeypatch.setattr(cand_pkg, "local_llm_call_json", fake_local_llm_call_json)

    result = find_funny_timestamps(str(transcript), min_words=1)
    assert result == []


def test_rating_threshold_excludes_seven(tmp_path: Path, monkeypatch) -> None:
    transcript = tmp_path / "t.txt"
    transcript.write_text("[0.00 -> 3.00] Placeholder text.\n", encoding="utf-8")

    def fake_local_llm_call_json(model, prompt, options=None, timeout=None):
        assert not hasattr(fake_local_llm_call_json, "called"), "tone check should not run"
        fake_local_llm_call_json.called = True
        return [
            {
                "start": 0.0,
                "end": 3.0,
                "rating": 7,
                "reason": "meh",
                "quote": "placeholder",
            }
        ]

    monkeypatch.setattr(cand_pkg, "local_llm_call_json", fake_local_llm_call_json)

    result = find_funny_timestamps(str(transcript), min_rating=7.0, min_words=1)
    assert result == []


def test_default_rating_filters_below_eight(tmp_path: Path, monkeypatch) -> None:
    transcript = tmp_path / "t.txt"
    transcript.write_text("[0.00 -> 3.00] Placeholder text.\n", encoding="utf-8")

    def fake_local_llm_call_json(model, prompt, options=None, timeout=None):
        assert not hasattr(fake_local_llm_call_json, "called"), "tone check should not run"
        fake_local_llm_call_json.called = True
        return [
            {
                "start": 0.0,
                "end": 3.0,
                "rating": 7.5,
                "reason": "meh",
                "quote": "placeholder",
            }
        ]

    monkeypatch.setattr(cand_pkg, "local_llm_call_json", fake_local_llm_call_json)

    result = find_funny_timestamps(str(transcript), min_words=1)
    assert result == []

