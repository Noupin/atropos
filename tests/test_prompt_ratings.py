from __future__ import annotations

from server.steps.candidates.prompts import _build_system_instructions


def test_custom_rating_descriptions_included() -> None:
    custom = {"10": "top tier"}
    instructions = _build_system_instructions(
        "desc", 5.0, rating_descriptions=custom
    )
    assert "9–10: extremely aligned" in instructions
    assert "10: top tier" in instructions
