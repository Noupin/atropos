from __future__ import annotations

from typing import Dict, Optional

from config import (
    MAX_DURATION_SECONDS,
    MIN_DURATION_SECONDS,
    SWEET_SPOT_MAX_SECONDS,
    SWEET_SPOT_MIN_SECONDS,
    RATING_MIN,
    RATING_MAX,
    WINDOW_SIZE_SECONDS,
    WINDOW_OVERLAP_SECONDS,
    WINDOW_CONTEXT_SECONDS,
)

FUNNY_PROMPT_DESC = (
    "Find self-contained funny beats that will make most viewers laugh. "
    "Edgy, inappropriate, or raunchy humor is allowed and should be scored if it delivers a comedic payoff. "
    "Only discard when the content is hateful, non-consensual, or purely offensive without wit. "
    "Embrace strange, weird, or delightfully crazy moments if they land a punchline. "
    "Prefer short setups with a clear punchline or twist (deadpan contradiction, playful roast, absurd confession, misdirection, escalation, wordplay). "
    "Highlight the comedic style (dry satire, slapstick, dark humor, etc.) when obvious and make the scenario's twist or contrast explicit. "
    "Structure each beat with setup, escalation, and punchline; pacing matters. "
    "The punchline must occur inside the clip window; do not return pure setup. Start slightly before the setup line and end just after the laugh/beat lands (≤1.5s). "
    "Favor tight beats (often ≤25s) over long stories unless the payoff is exceptional. "
    "Cues that often mark a punchline: audience laughter/\"(laughs)\", sudden contradiction (\"actually…\"), hyperbole or absurd comparisons, unexpected specifics, or a sharp reversal (\"turns out…\"). "
    "Your `quote` should capture the punchline line verbatim. "
    "`tags` must include at least one comedic device: [\"punchline\", \"roast\", \"callback\", \"absurdity\", \"wordplay\", \"misdirection\", \"deadpan\", \"escalation\"]; when possible add a tag for comedic style (e.g., \"slapstick\", \"dark\"). "
    "Reject: long rambles, setup-only segments, inside jokes that need unseen visuals, polite chuckles with no payoff, sponsor/promotional reads, or mean-spirited or hateful remarks without wit."
)


GENERAL_RATING_DESCRIPTIONS: Dict[str, str] = {
    "10": "rare, exceptional clip; perfect fit; instantly gripping and highly shareable",
    "9":  "rare, exceptional clip; excellent fit; strong hook and clear payoff",
    "8":  "very good; engaging and on-target (common; most clips fall here or below)",
    "7":  "good; include if few stronger options exist",
    "6":  "borderline; some issues with clarity or impact",
    "5":  "weak; limited relevance or momentum",
    "4":  "poor; off-target or confusing",
    "3":  "poor; off-target or confusing",
    "2":  "not usable; unclear or irrelevant",
    "1":  "not usable; unclear or irrelevant",
    "0":  "reject; misleading or inappropriate",
}


FUNNY_RATING_DESCRIPTIONS: Dict[str, str] = {
    "10": "can't stop laughing; universal hysterics",
    "9":  "guaranteed laugh; laugh-out-loud every time",
    "8":  "big laugh for most; very funny",
    "7":  "solid laugh; clearly funny",
    "6":  "lightly amusing; smile more than laugh",
    "5":  "weak humor; raunchy or crude without payoff",
    "4":  "poor joke; muddy setup or payoff",
    "3":  "barely humorous; off-tone or confusing",
    "2":  "not funny; flat or irrelevant",
    "1":  "not funny at all; offensive or crude with no humor",
    "0":  "reject; hateful or non-consensual content without comedic value",
}

INSPIRING_PROMPT_DESC = (
    "Find genuinely inspiring moments. Prefer concise stories of overcoming difficulty, heartfelt advice, or lines that motivate action. "
    "Avoid generic positivity, vague pep talk, or promotional fluff."
)

EDUCATIONAL_PROMPT_DESC = (
    "Find clear teaching moments. Prefer precise explanations, practical takeaways, and crisp how/why reasoning. "
    "Avoid speculation, marketing claims, or opinions that do not explain anything."
)

SPACE_PROMPT_DESC = (
    "Find mind-expanding space or astronomy moments that spark curiosity. "
    "Prefer surprising facts, clear explanations of cosmic phenomena, or awe-inspiring discoveries."
)

HISTORY_PROMPT_DESC = (
    "Find compelling historical anecdotes or insights. "
    "Prefer vivid stories, unexpected connections, or lessons drawn from the past."
)

TECH_PROMPT_DESC = (
    "Find interesting or useful technology insights. "
    "Prefer practical tips, clear explanations of how things work, or notable industry commentary."
)

HEALTH_PROMPT_DESC = (
    "Find engaging health or wellness takeaways. "
    "Prefer actionable advice, myth-busting explanations, or evidence-based insights."
)


def _build_system_instructions(
    prompt_desc: str, rating_descriptions: Optional[Dict[str, str]] = None
) -> str:
    return (
        "<start_of_turn>user\n"
        "You will extract high-quality, self-contained moments from a transcript. Follow these instructions exactly.\n\n"
        "OUTPUT FORMAT (strict):\n"
        "Return ONLY a valid JSON array, no prose, matching this schema:\n"
        "[{\"start\": number, \"end\": number, \"rating\": number, \"reason\": string, \"quote\": string, \"tags\": string[]}]\n\n"
        f"Duration: each item must be between {MIN_DURATION_SECONDS:.0f} and {MAX_DURATION_SECONDS:.0f} seconds; ideal is {SWEET_SPOT_MIN_SECONDS:.0f}–{SWEET_SPOT_MAX_SECONDS:.0f} seconds.\n"
        "If no suitable moments exist, return [].\n\n"
        "HARD RULES (must all be satisfied):\n"
        "- Self-contained: clear beginning and end; no missing context.\n"
        "- Boundaries: never start mid-word; begin at a natural lead-in and end just after the key beat lands (leave ~0.2–0.6s of tail room); prefer entering at the hook when possible. Always end at the end of a full sentence, not mid-thought.\n"
        "- Hook priority: the first 1–2 seconds must contain a clear hook (surprising line, bold claim, sharp question, or punchy setup). Trim silence/filler; avoid slow ramps. Prefer entering on the hook rather than several seconds of preamble.\n"
        "- Intro music: if there is intro music or a theme song at the start, begin the clip after the intro; never include music-only intros.\n"
        f"- Valid values: start < end; start ≥ 0; rating is a number {RATING_MIN:.1f}–{RATING_MAX:.1f} with one decimal place (e.g., 5.2, 6.7, 9.1). Do not restrict to .0 endings — use fractional decimals for nuance. No NaN/Infinity.\n"
        "- Quote fidelity: `quote` must appear within [start, end] and capture the core line.\n"
        "- Tags: include 1–5 short, lowercase tags describing the moment (topic or device).\n"
        "- Structure: every clip should present a setup, brief escalation, and a clear payoff.\n"
        "- Non-overlap & spacing: clips must not overlap and must be spaced by ≥ 2.0s; if two candidates would overlap or be closer than 2.0s, keep only the higher-rated one.\n"
        "- Near-duplicate filter: if two candidates share the same punchline/wording or their `quote` has >60% overlap, output only the strongest single version.\n"
        "- Tie-breaker: if two candidates are otherwise equal, pick the one with the stronger first 3 seconds and higher likely retention.\n"
        "- Unique reasons: each candidate's `reason` must differ; do not reuse identical explanations.\n"
        "- JSON only: return just the array; no commentary, markdown, or extra keys.\n"
        "- If uncertain whether a candidate meets the rules, exclude it.\n\n"
        "ALWAYS EXCLUDE (never return these):\n"
        "- Sponsor reads, ads, shout-outs, Patreon/merch/member plugs, pre-rolls/post-rolls, discount codes (e.g., \"use code\"), link/subscribe calls-to-action, or any promotional content.\n"
        "- Filler/housekeeping, bland agreement, or mere logistics (\"what time is it\", \"we'll be right back\").\n"
        "- Partial thoughts that end before the key beat/payoff.\n\n"
        "SCORING GUIDE (general):\n"
        + "\n".join([f"{rating}: {desc}" for rating, desc in GENERAL_RATING_DESCRIPTIONS.items()])
        + ("\n\nTONE-SPECIFIC NOTES:\n" + "\n".join([f"{rating}: {desc}" for rating, desc in rating_descriptions.items()]) if rating_descriptions else "")
        + "\n\n"
        "Scores above 8 are reserved for truly standout clips; when uncertain, "
        "default to a lower score.\n\n"
        "INSTRUCTIONS SOURCE (for context, not a style target):\n"
        f"{prompt_desc}\n"
        "Return the JSON now.\n"
        "<end_of_turn>\n<start_of_turn>model"
    )




def build_window_prompt(prompt_desc: str, text: str) -> str:
    """Construct a complete prompt for a transcript window."""
    system_instructions = _build_system_instructions(prompt_desc)
    return (
        f"{system_instructions}\n\n"
        f"TRANSCRIPT WINDOW (≈{WINDOW_SIZE_SECONDS:.0f}s, overlap {WINDOW_OVERLAP_SECONDS:.0f}s, context {WINDOW_CONTEXT_SECONDS:.0f}s):\n{text}\n\n"
        "Return JSON now."
    )


__all__ = [
    "FUNNY_PROMPT_DESC",
    "INSPIRING_PROMPT_DESC",
    "EDUCATIONAL_PROMPT_DESC",
    "SPACE_PROMPT_DESC",
    "HISTORY_PROMPT_DESC",
    "TECH_PROMPT_DESC",
    "HEALTH_PROMPT_DESC",
    "GENERAL_RATING_DESCRIPTIONS",
    "FUNNY_RATING_DESCRIPTIONS",
    "_build_system_instructions",
    "build_window_prompt",
]
