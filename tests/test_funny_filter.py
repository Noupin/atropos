from __future__ import annotations

from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "server"))

import server.steps.candidates as cand_pkg
from server.steps.candidates.tone import find_candidates_by_tone, Tone


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

    result = find_candidates_by_tone(str(transcript), tone=Tone.FUNNY, min_words=1)
    assert result == []


def test_batched_min_rating_inclusive(tmp_path: Path, monkeypatch) -> None:
    transcript = tmp_path / "t.txt"
    transcript.write_text(
        "[0.00 -> 3.00] first line.\n[3.00 -> 6.00] second line.\n",
        encoding="utf-8",
    )

    def fake_local_llm_call_json(model, prompt, options=None, timeout=None):
        if not hasattr(fake_local_llm_call_json, "calls"):
            fake_local_llm_call_json.calls = 0
        fake_local_llm_call_json.calls += 1
        if fake_local_llm_call_json.calls == 1:
            return [
                {
                    "start": 0.0,
                    "end": 3.0,
                    "rating": 9.5,
                    "reason": "great",
                    "quote": "first line",
                },
                {
                    "start": 3.0,
                    "end": 6.0,
                    "rating": 9.4,
                    "reason": "meh",
                    "quote": "second line",
                },
            ]
        return {"match": True}

    monkeypatch.setattr(cand_pkg, "local_llm_call_json", fake_local_llm_call_json)

    result = find_candidates_by_tone(
        str(transcript), tone=Tone.FUNNY, min_rating=9.5, min_words=1
    )
    assert len(result) == 1
    assert result[0].rating == 9.5


def test_rating_threshold_excludes_below_min(tmp_path: Path, monkeypatch) -> None:
    transcript = tmp_path / "t.txt"
    transcript.write_text("[0.00 -> 3.00] Placeholder text.\n", encoding="utf-8")

    def fake_local_llm_call_json(model, prompt, options=None, timeout=None):
        assert not hasattr(fake_local_llm_call_json, "called"), "tone check should not run"
        fake_local_llm_call_json.called = True
        return [
            {
                "start": 0.0,
                "end": 3.0,
                "rating": 6.9,
                "reason": "meh",
                "quote": "placeholder",
            }
        ]

    monkeypatch.setattr(cand_pkg, "local_llm_call_json", fake_local_llm_call_json)

    result = find_candidates_by_tone(
        str(transcript), tone=Tone.FUNNY, min_rating=7.0, min_words=1
    )
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

    result = find_candidates_by_tone(str(transcript), tone=Tone.FUNNY, min_words=1)
    assert result == []


def test_generic_tone_funny(tmp_path: Path, monkeypatch) -> None:
    transcript = tmp_path / "t.txt"
    transcript.write_text(
        "[0.00 -> 3.00] setup line.\n[3.00 -> 6.00] punchline here.\n",
        encoding="utf-8",
    )

    def fake_local_llm_call_json(model, prompt, options=None, timeout=None):
        if not hasattr(fake_local_llm_call_json, "calls"):
            fake_local_llm_call_json.calls = 0
        fake_local_llm_call_json.calls += 1
        if fake_local_llm_call_json.calls == 1:
            return [
                {
                    "start": 0.0,
                    "end": 3.0,
                    "rating": 9.0,
                    "reason": "funny",
                    "quote": "setup line",
                }
            ]
        return {"match": True}

    monkeypatch.setattr(cand_pkg, "local_llm_call_json", fake_local_llm_call_json)

    result = find_candidates_by_tone(str(transcript), tone=Tone.FUNNY, min_words=1)
    assert len(result) == 1

