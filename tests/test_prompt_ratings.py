from __future__ import annotations

from server.steps.candidates.prompts import (
    _build_system_instructions,
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
    assert "10: hysterical or delightfully weird" in instructions
    assert "0: reject; offensive without comedic value" in instructions

