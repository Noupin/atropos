from __future__ import annotations

from server.steps.candidates.prompts import (
    _build_system_instructions,
    FUNNY_RATING_DESCRIPTIONS,
)


def test_default_rating_descriptions_present() -> None:
    instructions = _build_system_instructions("desc", 5.0)
    assert "10: extremely aligned" in instructions
    assert "0: not relevant" in instructions


def test_custom_rating_descriptions_included() -> None:
    custom = {"10": "top tier"}
    instructions = _build_system_instructions(
        "desc", 5.0, rating_descriptions=custom
    )
    assert "10: extremely aligned" in instructions
    assert "10: top tier" in instructions


def test_funny_rating_descriptions_included() -> None:
    instructions = _build_system_instructions(
        "desc", 5.0, rating_descriptions=FUNNY_RATING_DESCRIPTIONS
    )
    assert "10: hysterical" in instructions
    assert "0: actively unfunny" in instructions

