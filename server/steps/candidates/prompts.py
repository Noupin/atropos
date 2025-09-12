from __future__ import annotations

from typing import Dict, Optional

from config import (
    MAX_DURATION_SECONDS,
    MIN_DURATION_SECONDS,
    SWEET_SPOT_MAX_SECONDS,
    SWEET_SPOT_MIN_SECONDS,
    WINDOW_SIZE_SECONDS,
    WINDOW_OVERLAP_SECONDS,
    WINDOW_CONTEXT_PERCENTAGE,
)

FUNNY_PROMPT_DESC = """
TONE-SPECIFIC:
- Find one atomic joke: setup -> escalation -> punchline.
- `reason` must start "funny because ..." and name the device (misdirection, roast, wordplay, escalation, deadpan, callback).
- `quote` must capture the punchline or exact comedic turn.
- Exclude hateful or non-consensual content without wit.
"""


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

SPACE_PROMPT_DESC = """
TONE-SPECIFIC:
- Pick awe/curiosity beats: crisp explanations, scale analogies, or mission milestones that matter.
- `reason` must start "space awe because ..." and name the insight (scale, counterintuitive fact, mission update, explanation).
- `quote` captures the core awe/insight line.
- Exclude rambling fact lists or speculation framed as certainty.
"""

HISTORY_PROMPT_DESC = """
TONE-SPECIFIC:
- Pick consequential mini-stories: decisions, reversals, firsts/lasts, declassifications, or misconceptions corrected, with clear stakes.
- `reason` must start "history because ..." and name the stakes and device (turning point, irony, first/last, declassified, misconception). Mark disputed claims as tentative.
- `quote` captures the twist/decision or the most quotable line.
- Exclude trivia lists, myths as facts, or partisan hot takes.
"""

TECH_PROMPT_DESC = """
TONE-SPECIFIC:
- Deliver practical tech value: clear how-it-works, actionable tips, or trade-offs.
- `reason` must start "tech because ..." and name the insight or trade-off.
- `quote` captures the actionable claim or key takeaway.
- Exclude vague hype or sales pitches.
"""

HEALTH_PROMPT_DESC = """
TONE-SPECIFIC:
- Offer evidence-aware, safe guidance or careful myth-busting.
- `reason` must start "health because ..." and state the takeaway with guardrails (note evidence type if stated).
- `quote` captures the key advice or myth-busting line.
- Exclude unsafe claims or overconfident prescriptions.
"""

SPACE_RATING_DESCRIPTIONS = {
    "10": "jaw-dropping; unforgettable sense of scale or breakthrough; crystal clarity",
    "9":  "profound awe; crisp explanation and memorable takeaway",
    "8":  "strong curiosity spark; clear and engaging",
    "7":  "good; informative with a decent hook",
    "6":  "borderline; needs tighter framing or clearer why",
    "5":  "weak; facts without a point or takeaway",
    "4":  "poor; meandering jargon or half-claim",
    "3":  "poor; confusing or unfocused",
    "2":  "not usable; unclear, speculative without grounding",
    "1":  "not usable; misleading or off-topic",
    "0":  "reject; sensational claim without evidence or unsafe misinformation",
}

HISTORY_RATING_DESCRIPTIONS = {
    "10": "mini‑epic; clear stakes and unforgettable payoff; verified details; obvious significance",
    "9":  "excellent story; strong stakes, crisp twist, and consequence",
    "8":  "very good; clear narrative with meaningful takeaway",
    "7":  "good; solid anecdote with acceptable context",
    "6":  "borderline; stakes or payoff underexplained",
    "5":  "weak; facts without a point or consequence",
    "4":  "poor; disjointed or confusing",
    "3":  "poor; trivial or off‑track",
    "2":  "not usable; unsubstantiated or misleading",
    "1":  "not usable; moralizing without evidence",
    "0":  "reject; misinformation or hateful content",
}

TECH_RATING_DESCRIPTIONS = {
    "10": "instant bookmark; actionable and insight-dense",
    "9":  "excellent takeaway; clear trade-offs or demo",
    "8":  "very useful; practical and well-explained",
    "7":  "good; helpful but could be tighter",
    "6":  "borderline; some value but muddy",
    "5":  "weak; generic or hypey",
    "4":  "poor; unclear or hand-wavy",
    "3":  "poor; off-topic or inaccurate",
    "2":  "not usable; wrong or unsafe guidance",
    "1":  "not usable; salesy with no substance",
    "0":  "reject; deceptive claims or undisclosed promotion",
}

HEALTH_RATING_DESCRIPTIONS = {
    "10": "gold-standard clarity; safe, nuanced, and actionable",
    "9":  "excellent; strong guardrails and memorable tip",
    "8":  "very good; evidence-aware and useful",
    "7":  "good; helpful but could be clearer",
    "6":  "borderline; missing guardrails or precise terms",
    "5":  "weak; generic or oversimplified",
    "4":  "poor; confusing or potentially misleading",
    "3":  "poor; off-topic or anecdotal-only",
    "2":  "not usable; unsafe or unsupported",
    "1":  "not usable; shaming/absolute claims",
    "0":  "reject; dangerous misinformation",
}

def _build_system_instructions(
    prompt_desc: str, rating_descriptions: Optional[Dict[str, str]] = None
) -> str:
    return (
        "<start_of_turn>user\n"
        "Extract self-contained video clips from this transcript. Follow all rules exactly.\n\n"
        "OUTPUT (strict):\n"
        "- Must return exactly one valid JSON array. First char '[' and last char ']'.\n"
        "- RFC 8259 JSON: double-quoted keys/strings, commas between items, no trailing commas, no comments/markdown/backticks.\n"
        "- ASCII printable only (U+0020–U+007E). No emojis or smart quotes.\n\n"
        "SCHEMA (exact):\n"
        "[{\"start\": number, \"end\": number, \"rating\": number, \"reason\": string, \"quote\": string, \"tags\": string[]}]\n\n"
        "CLIP RULES:\n"
        f"- Clip length: {MIN_DURATION_SECONDS:.0f}-{MAX_DURATION_SECONDS:.0f}s. "
        f"Stay in the {SWEET_SPOT_MIN_SECONDS:.0f}-{SWEET_SPOT_MAX_SECONDS:.0f}s sweet spot; "
        f"treat {SWEET_SPOT_MAX_SECONDS:.0f}s as a speed limit—"
        "only exceed it when a longer clip is exceptionally funny and cannot be trimmed. "
        f"- Never output a clip longer than {MAX_DURATION_SECONDS:.0f}s. If a great moment is longer, SPLIT it into multiple adjacent items, each within the limits.\n"
        "- Up to 6 items total.\n"
        "- reason <= 240 chars; quote <= 200 chars.\n"
        "- tags: 1-5 items; each <= 24 chars.\n"
        "- Atomic: one beat; begin on a natural lead-in; end right after the payoff.\n"
        "- Hook: a clear hook in the first ~2s; trim silence/filler.\n"
        f"- Do not round-trip your own durations: explicitly set `end - start` <= {MAX_DURATION_SECONDS:.0f}s. If uncertain, shorten, do not extend.\n"
        "- No overlaps; maintain >= 2.0s spacing; keep only the higher-rated if they would collide.\n"
        "- Quote must be inside [start,end]; reason cites only lines within that span.\n"
        "- Valid values: start < end; start >= 0; rating is a decimal number within allowed range. No NaN/Infinity.\n"
        "- If any rule cannot be met perfectly, return [].\n\n"
        "TONE-SPECIFIC:\n"
        f"{prompt_desc}\n\n"
        "TRANSCRIPT (approx window shown):\n"
        "{TEXT}\n\n"
        "Return JSON now.\n"
        "<end_of_turn>\n<start_of_turn>model"
    )




def build_window_prompt(
    prompt_desc: str,
    text: str,
    rating_descriptions: Optional[Dict[str, str]] = None,
) -> str:
    """Construct a complete prompt for a transcript window."""
    system_instructions = _build_system_instructions(
        prompt_desc, rating_descriptions
    )
    context_secs = WINDOW_SIZE_SECONDS * WINDOW_CONTEXT_PERCENTAGE
    # Replace the {TEXT} token with the actual transcript window text
    filled = system_instructions.replace("{TEXT}", text)
    return (
        f"{filled}\n"
        f"(window \u2248 {WINDOW_SIZE_SECONDS:.0f}s, overlap {WINDOW_OVERLAP_SECONDS:.0f}s, context {context_secs:.0f}s)"
    )


__all__ = [
    "FUNNY_PROMPT_DESC",
    "SPACE_PROMPT_DESC",
    "HISTORY_PROMPT_DESC",
    "TECH_PROMPT_DESC",
    "HEALTH_PROMPT_DESC",
    "GENERAL_RATING_DESCRIPTIONS",
    "FUNNY_RATING_DESCRIPTIONS",
    "SPACE_RATING_DESCRIPTIONS",
    "HISTORY_RATING_DESCRIPTIONS",
    "TECH_RATING_DESCRIPTIONS",
    "HEALTH_RATING_DESCRIPTIONS",
    "_build_system_instructions",
    "build_window_prompt",
]
