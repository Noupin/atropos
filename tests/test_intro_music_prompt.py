from __future__ import annotations

from server.steps.candidates.prompts import _build_system_instructions, FUNNY_PROMPT_DESC


def test_prompt_mentions_intro_music_filter() -> None:
    prompt = _build_system_instructions(FUNNY_PROMPT_DESC)
    lower = prompt.lower()
    assert "intro music" in lower
