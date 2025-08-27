from __future__ import annotations

FUNNY_PROMPT_DESC = (
    "genuinely funny, laugh-inducing moments. Focus on bits that have a clear setup and a punchline, "
    "or a sharp twist/surprise. Prioritize incongruity, exaggeration, taboo/embarrassment (PG–R), "
    "playful insults/roasts, callbacks, misdirection, and deadpan contradictions. Avoid bland banter, "
    "filler agreement, or mere information."
)

INSPIRING_PROMPT_DESC = (
    "uplifting or motivational moments that stir positive emotion, showcase overcoming "
    "challenges, or deliver heartfelt advice."
)

EDUCATIONAL_PROMPT_DESC = (
    "informative, insightful, or instructional moments that clearly teach a concept or "
    "share useful facts."
)


def _build_system_instructions(prompt_desc: str, min_rating: float) -> str:
    return (
        f"You are ranking moments that are most aligned with this target: {prompt_desc}\n"
        "Return a JSON array ONLY. Each item MUST be: "
        '{"start": number, "end": number, "rating": 1-10 number, '
        '"reason": string, "quote": string, "tags": string[]}\n'
        f"Include ONLY items with rating >= {min_rating}.\n"
        "RUBRIC (all must be true for inclusion):\n"
        "- Relevance: The moment strongly reflects the target described above.\n"
        "- Coherence: It forms a self-contained beat; the audience will understand without extra context.\n"
        "- Clipability: It is engaging and quotable; likely to grab attention in a short clip.\n"
        "- Completeness: Start at the natural setup/lead-in (not mid-word) and end right after the payoff/beat lands.\n"
        "NEGATIVE FILTERS (exclude these):\n"
        "- Filler, bland agreement, mere exposition, or housekeeping.\n"
        "- Partial thoughts that cut off before the key beat/payoff.\n"
        "SCORING GUIDE:\n"
        "9–10: extremely aligned, highly engaging, shareable.\n"
        "8: clearly strong, likely to resonate with most viewers.\n"
        "7: decent; include only if there are few stronger options in this span.\n"
        "TIMING RULES:\n"
        "- Prefer segment boundaries; may extend across adjacent lines to capture the full beat.\n"
        "- Do NOT invent timestamps outside provided ranges.\n"
    )


__all__ = [
    "FUNNY_PROMPT_DESC",
    "INSPIRING_PROMPT_DESC",
    "EDUCATIONAL_PROMPT_DESC",
    "_build_system_instructions",
]
