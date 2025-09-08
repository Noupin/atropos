from __future__ import annotations

from server.steps.candidates.prompts import (
    _build_system_instructions,
    FUNNY_PROMPT_DESC,
)
from server.custom_types.tone import Tone
from server.steps.candidates.tone import STRATEGY_REGISTRY


def test_default_rating_descriptions_present() -> None:
    instructions = _build_system_instructions("desc")
    assert "10: rare, exceptional clip" in instructions
    assert "0: reject" in instructions


def test_instructions_require_json_array() -> None:
    instructions = _build_system_instructions("desc")
    assert "return []" in instructions


def test_custom_rating_descriptions_included() -> None:
    custom = {"10": "top tier"}
    instructions = _build_system_instructions(
        "desc", rating_descriptions=custom
    )
    assert "10: rare, exceptional clip" in instructions
    assert "10: top tier" in instructions


def test_funny_rating_descriptions_included() -> None:
    strategy = STRATEGY_REGISTRY[Tone.FUNNY]
    instructions = _build_system_instructions(
        strategy.prompt_desc, strategy.rating_descriptions
    )
    assert (
        f"10: {strategy.rating_descriptions['10']}" in instructions
    )
    assert (
        f"5: {strategy.rating_descriptions['5']}" in instructions
    )
    assert (
        f"0: {strategy.rating_descriptions['0']}" in instructions
    )


def test_funny_prompt_mentions_raunch() -> None:
    prompt = _build_system_instructions(FUNNY_PROMPT_DESC)
    lower = prompt.lower()
    assert "raunchy" in lower

