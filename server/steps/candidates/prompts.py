from __future__ import annotations

from typing import Dict, Optional

from .config import (
    MAX_DURATION_SECONDS,
    MIN_DURATION_SECONDS,
    SWEET_SPOT_MAX_SECONDS,
    SWEET_SPOT_MIN_SECONDS,
)

FUNNY_PROMPT_DESC = (
    "Find self-contained funny beats. Prefer short setups with clear punchlines or absurd twists—deadpan contradictions, playful roasts, or quick shocking confessions. "
    "Avoid long rambles, inside jokes that need unseen visuals, polite chuckles with no payoff, and any promo/sponsor content."
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
    "10": "hysterical; broad laugh for most viewers",
    "9":  "extremely funny; tight setup and clean punchline",
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
    prompt_desc: str, min_rating: float, rating_descriptions: Optional[Dict[str, str]] = None
) -> str:
    scoring_lines = [
        f"{rating}: {desc}" for rating, desc in GENERAL_RATING_DESCRIPTIONS.items()
    ]
    if rating_descriptions:
        for rating, desc in rating_descriptions.items():
            scoring_lines.append(f"{rating}: {desc}")
    scoring_guide = "SCORING GUIDE:\n" + "\n".join(scoring_lines) + "\n"

    return (
        "<start_of_turn>user\n"
        f"You are selecting transcript moments that best match this target tone:\n\n{prompt_desc}\n\n"
        "Output ONLY a JSON array of objects with this exact shape (no prose):\n"
        "[{\"start\": number, \"end\": number, \"rating\": number, \"reason\": string, \"quote\": string, \"tags\": string[]}]\n\n"
        f"Include only items with rating > {min_rating}. Ratings use 0–10.\n"
        f"Duration must be between {MIN_DURATION_SECONDS:.0f} and {MAX_DURATION_SECONDS:.0f} seconds; ideal is {SWEET_SPOT_MIN_SECONDS:.0f}–{SWEET_SPOT_MAX_SECONDS:.0f} seconds.\n\n"
        "RULES:\n"
        "- Relevance: strongly reflects the target tone.\n"
        "- Coherence: a self-contained beat; no missing context.\n"
        "- Clipability: hook + payoff; quotable; attention-friendly.\n"
        "- Boundaries: never start mid-word; end right after the beat lands.\n"
        "- Strictness: if tone alignment is uncertain, exclude it.\n\n"
        "NEGATIVE FILTERS (exclude):\n"
        "- Filler/housekeeping/bland agreement/mere exposition.\n"
        "- Partial thoughts that end before the payoff.\n"
        "- Sponsor reads, ads, shoutouts, or promotional segments.\n\n"
        "POST-PROCESSING NOTES (craft clips that survive):\n"
        "- Starts/ends snap to dialog boundaries; adjacent/overlapping clips may merge.\n"
        "- Overlapping clips are pruned to keep only the strongest.\n"
        "- A secondary tone check drops off-tone or too-short clips.\n\n"
        "SCORING GUIDE:\n"
        + "\n".join([f"{rating}: {desc}" for rating, desc in GENERAL_RATING_DESCRIPTIONS.items()])
        + ("\n" + "\n".join([f"{rating}: {desc}" for rating, desc in rating_descriptions.items()]) if rating_descriptions else "")
        + "\n<end_of_turn>\n<start_of_turn>model"
    )


__all__ = [
    "FUNNY_PROMPT_DESC",
    "INSPIRING_PROMPT_DESC",
    "EDUCATIONAL_PROMPT_DESC",
    "GENERAL_RATING_DESCRIPTIONS",
    "FUNNY_RATING_DESCRIPTIONS",
    "_build_system_instructions",
]
