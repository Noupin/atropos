from __future__ import annotations

from typing import Dict, Optional

from config import (
    MAX_DURATION_SECONDS,
    MIN_DURATION_SECONDS,
    SWEET_SPOT_MAX_SECONDS,
    SWEET_SPOT_MIN_SECONDS,
)

FUNNY_PROMPT_DESC = (
    "Find self-contained funny beats that will make most viewers laugh. "
    "Embrace strange, weird, or delightfully crazy moments if they land a punchline. "
    "Prefer short setups with a clear punchline or twist (deadpan contradiction, playful roast, absurd confession, misdirection, escalation, wordplay). "
    "Highlight the comedic style (dry satire, slapstick, dark humor, etc.) when obvious and make the scenario's twist or contrast explicit. "
    "Structure each beat with setup, escalation, and punchline; pacing matters. "
    "The punchline must occur inside the clip window; do not return pure setup. Start slightly before the setup line and end just after the laugh/beat lands (≤1.5s). "
    "Favor tight beats (often ≤25s) over long stories unless the payoff is exceptional. "
    "Cues that often mark a punchline: audience laughter/\"(laughs)\", sudden contradiction (\"actually…\"), hyperbole or absurd comparisons, unexpected specifics, or a sharp reversal (\"turns out…\"). "
    "Your `quote` should capture the punchline line verbatim. "
    "`tags` must include at least one comedic device: [\"punchline\", \"roast\", \"callback\", \"absurdity\", \"wordplay\", \"misdirection\", \"deadpan\", \"escalation\"]; when possible add a tag for comedic style (e.g., \"slapstick\", \"dark\"). "
    "Reject: long rambles, setup-only segments, inside jokes that need unseen visuals, polite chuckles with no payoff, sponsor/promotional reads, or mean-spirited remarks without wit."
)


GENERAL_RATING_DESCRIPTIONS: Dict[str, str] = {
    "10": "perfect fit; instantly gripping and highly shareable",
    "9":  "excellent fit; strong hook and clear payoff",
    "8":  "very good; engaging and on-target",
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
    "10": "hysterical or delightfully weird; broad laugh for most viewers",
    "9":  "extremely funny; tight setup and clean punchline; may be cleverly absurd",
    "8":  "very funny; strong laugh for many",
    "7":  "clearly funny; earns a chuckle",
    "6":  "lightly amusing; smile more than laugh",
    "5":  "weak humor; unlikely to land",
    "4":  "poor joke; muddy setup or payoff",
    "3":  "barely humorous; off-tone or confusing",
    "2":  "not funny; flat or irrelevant",
    "1":  "not funny at all",
    "0":  "reject; offensive without comedic value",
}

INSPIRING_PROMPT_DESC = (
    "Find genuinely inspiring moments. Prefer concise stories of overcoming difficulty, heartfelt advice, or lines that motivate action. "
    "Avoid generic positivity, vague pep talk, or promotional fluff."
)

EDUCATIONAL_PROMPT_DESC = (
    "Find clear teaching moments. Prefer precise explanations, practical takeaways, and crisp how/why reasoning. "
    "Avoid speculation, marketing claims, or opinions that do not explain anything."
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
        "- Boundaries: never start mid-word; begin at a natural lead-in and end just after the key beat lands (leave ~0.2–0.6s of tail room).\n"
        "- Valid values: start < end; start ≥ 0; rating is a number 0–10 (not a string, float allowed, e.g., 5.2); no NaN/Infinity.\n"
        "- Quote fidelity: `quote` must appear within [start, end] and capture the core line.\n"
        "- Tags: include 1–5 short, lowercase tags describing the moment (topic or device).\n"
        "- Structure: every clip should present a setup, brief escalation, and a clear payoff.\n"
        "- Non-overlap & spacing: clips must not overlap and must be spaced by ≥ 2.0s; if two candidates would overlap or be closer than 2.0s, keep only the higher-rated one.\n"
        "- Near-duplicate filter: if two candidates share the same punchline/wording or their `quote` has >60% overlap, output only the strongest single version.\n"
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
        "INSTRUCTIONS SOURCE (for context, not a style target):\n"
        f"{prompt_desc}\n"
        "Return the JSON now.\n"
        "<end_of_turn>\n<start_of_turn>model"
    )


__all__ = [
    "FUNNY_PROMPT_DESC",
    "INSPIRING_PROMPT_DESC",
    "EDUCATIONAL_PROMPT_DESC",
    "GENERAL_RATING_DESCRIPTIONS",
    "FUNNY_RATING_DESCRIPTIONS",
    "_build_system_instructions",
]
