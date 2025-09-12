from __future__ import annotations

from server.steps.candidates.prompts import _build_system_instructions, FUNNY_PROMPT_DESC


def test_prompt_mentions_clip_length() -> None:
    prompt = _build_system_instructions(FUNNY_PROMPT_DESC)
    lower = prompt.lower()
    assert "clip length" in lower
    assert "sweet spot" in lower
    assert "speed limit" in lower
    assert "never output a clip longer" in lower
