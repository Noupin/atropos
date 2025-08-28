from __future__ import annotations

from .config import (
    MAX_DURATION_SECONDS,
    MIN_DURATION_SECONDS,
    SWEET_SPOT_MAX_SECONDS,
    SWEET_SPOT_MIN_SECONDS,
)

FUNNY_PROMPT_DESC = (
    "genuinely funny, laugh-inducing moments. Focus on bits that have a clear setup and a punchline, "
    "or a sharp twist/surprise. Prioritize incongruity, exaggeration, taboo/embarrassment (PG–R), "
    "playful insults/roasts, callbacks, misdirection, and deadpan contradictions. Avoid bland banter, "
    "filler agreement, or mere information. Reject polite chuckles, self-referential commentary without a joke, "
    "sarcasm lacking a payoff, or anything that only works with unseen visual context. "
    "Exclude promotional segments, sponsor mentions, or Patreon shoutouts."
)

INSPIRING_PROMPT_DESC = (
    "uplifting or motivational moments that stir positive emotion, showcase overcoming "
    "challenges, or deliver heartfelt advice. Exclude generic compliments, shallow positivity, or "
    "promotional sound bites that lack an emotional arc."
)

EDUCATIONAL_PROMPT_DESC = (
    "informative, insightful, or instructional moments that clearly teach a concept or "
    "share useful facts. Reject vague opinions, hearsay, or marketing pitches that do not explain how or why."
)


def _build_system_instructions(prompt_desc: str, min_rating: float) -> str:
    return (
        f"You are ranking moments that are most aligned with this target: {prompt_desc}\n"
        "Return a JSON array ONLY. Each item MUST be: "
        '{"start": number, "end": number, "rating": 0-10 number, '
        '"reason": string, "quote": string, "tags": string[]}\n'
        f"Include ONLY items with rating > {min_rating}.\n"
        "RUBRIC (all must be true for inclusion):\n"
        "- Relevance: The moment strongly reflects the target described above.\n"
        "- Coherence: It forms a self-contained beat; the audience will understand without extra context.\n"
        "- Clipability: It is engaging and quotable; likely to grab attention in a short clip.\n"
        f"- Duration: Must be between {MIN_DURATION_SECONDS:.0f} and {MAX_DURATION_SECONDS:.0f} seconds; "
        f"clips in the {SWEET_SPOT_MIN_SECONDS:.0f}-{SWEET_SPOT_MAX_SECONDS:.0f}s range are ideal.\n"
        "- Completeness: Start at the natural setup/lead-in (not mid-word) and end right after the payoff/beat lands.\n"
        "- Strictness: If tone alignment is questionable or borderline, exclude the moment.\n"
        "NEGATIVE FILTERS (exclude these):\n"
        "- Filler, bland agreement, mere exposition, or housekeeping.\n"
        "- Partial thoughts that cut off before the key beat/payoff.\n"
        "- Any segment that conflicts with the tone-specific negative examples.\n"
        "- Promotional segments such as sponsor reads, ads, or Patreon shoutouts.\n"
        "SCORING GUIDE:\n"
        "9–10: extremely aligned, highly engaging, shareable.\n"
        "8: clearly strong, likely to resonate with most viewers.\n"
        "7: decent; include only if there are few stronger options in this span.\n"
        "6: borderline; noticeable issues with relevance, clarity, or engagement.\n"
        "5: weak; minimal relevance or impact.\n"
        "3–4: poor; off-target or confusing.\n"
        "0–2: not relevant, incoherent, or unusable.\n"
        "POST-PROCESSING (automated filters applied after your response; craft clips that survive them):\n"
        "- Segments with promotional content are dropped—avoid promos entirely.\n"
        "- Start/end times snap to dialog boundaries and adjacent or overlapping clips may merge—pick clean boundaries and limit overlap.\n"
        "- Overlapping clips are pruned so only the strongest remain—suggest distinct beats.\n"
        "- A secondary tone check drops clips that are off-tone or too short—ensure each clearly fits the target tone.\n"
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
