from __future__ import annotations

from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "server"))

import server.steps.candidates as cand_pkg
from server.steps.candidates.tone import find_candidates_by_tone, Tone
from server.steps.candidates.prompts import _build_system_instructions, FUNNY_PROMPT_DESC


def test_promotional_segments_rejected(tmp_path: Path, monkeypatch) -> None:
    transcript = tmp_path / "t.txt"
    transcript.write_text(
        "[0.00 -> 5.00] This episode is brought to you by our patrons on Patreon.\n",
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
                    "end": 5.0,
                    "rating": 9,
                    "reason": "promo",
                    "quote": "patreon plug",
                }
            ]
        return {"match": True}

    monkeypatch.setattr(cand_pkg, "local_llm_call_json", fake_local_llm_call_json)

    result = find_candidates_by_tone(str(transcript), tone=Tone.FUNNY, min_words=1)
    assert result == []


def test_sponsorship_segments_rejected(tmp_path: Path, monkeypatch) -> None:
    transcript = tmp_path / "t.txt"
    transcript.write_text(
        "[0.00 -> 5.00] Today's video has a special sponsorship from ACME Corp.\n",
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
                    "end": 5.0,
                    "rating": 9,
                    "reason": "promo",
                    "quote": "sponsorship plug",
                }
            ]
        return {"match": True}

    monkeypatch.setattr(cand_pkg, "local_llm_call_json", fake_local_llm_call_json)

    result = find_candidates_by_tone(str(transcript), tone=Tone.FUNNY, min_words=1)
    assert result == []


def test_sponsor_continuation_rejected(tmp_path: Path, monkeypatch) -> None:
    transcript = tmp_path / "t.txt"
    transcript.write_text(
        (
            "[0.00 -> 5.00] This episode is brought to you by ACME Corp.\n"
            "[5.00 -> 10.00] Use code XYZ for a discount.\n"
        ),
        encoding="utf-8",
    )

    def fake_local_llm_call_json(model, prompt, options=None, timeout=None):
        if not hasattr(fake_local_llm_call_json, "calls"):
            fake_local_llm_call_json.calls = 0
        fake_local_llm_call_json.calls += 1
        if fake_local_llm_call_json.calls == 1:
            return [
                {
                    "start": 5.0,
                    "end": 10.0,
                    "rating": 9,
                    "reason": "promo",
                    "quote": "discount code",
                }
            ]
        return {"match": True}

    monkeypatch.setattr(cand_pkg, "local_llm_call_json", fake_local_llm_call_json)

    result = find_candidates_by_tone(str(transcript), tone=Tone.FUNNY, min_words=1)
    assert result == []


def test_prompt_mentions_promotional_filter() -> None:
    prompt = _build_system_instructions(FUNNY_PROMPT_DESC)
    lower = prompt.lower()
    assert "sponsor" in lower
    assert "patreon" in lower
