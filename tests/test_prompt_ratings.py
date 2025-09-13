from __future__ import annotations

from server.steps.candidates.prompts import (
    _build_system_instructions,
    FUNNY_PROMPT_DESC,
)
from server.custom_types.ETone import Tone
from server.steps.candidates.tone import STRATEGY_REGISTRY


def test_default_rating_descriptions_present() -> None:
    instructions = _build_system_instructions("desc")
    assert "10: rare, exceptional clip" in instructions
    assert "0: reject" in instructions


def test_instructions_require_json_array() -> None:
    instructions = _build_system_instructions("desc")
    assert "return []" in instructions


def test_reason_coverage_rule_present() -> None:
    instructions = _build_system_instructions("desc")
    assert "Reason coverage" in instructions
    assert "lines cited in `reason`" in instructions


def test_reason_and_quote_match_tone() -> None:
    instructions = _build_system_instructions("desc")
    assert "reason` must explain how the moment fits the tone" in instructions
    assert "quote` must capture a line that showcases that tone" in instructions


def test_funny_prompt_mentions_raunch() -> None:
    prompt = _build_system_instructions(FUNNY_PROMPT_DESC)
    lower = prompt.lower()
    assert "raunchy" in lower

