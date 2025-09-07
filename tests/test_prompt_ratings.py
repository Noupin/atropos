from __future__ import annotations

from server.steps.candidates.prompts import (
    _build_system_instructions,
    FUNNY_PROMPT_DESC,
    FUNNY_RATING_DESCRIPTIONS,
)


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
    instructions = _build_system_instructions(
        "desc", rating_descriptions=FUNNY_RATING_DESCRIPTIONS
    )
    assert "10: can't stop laughing" in instructions
    assert "5: weak humor; raunchy or crude without payoff" in instructions
    assert "0: reject; hateful or non-consensual content without comedic value" in instructions


def test_funny_prompt_mentions_raunch() -> None:
    prompt = _build_system_instructions(FUNNY_PROMPT_DESC)
    lower = prompt.lower()
    assert "raunchy" in lower

