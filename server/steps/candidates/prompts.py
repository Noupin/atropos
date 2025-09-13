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

SCIENCE_PROMPT_DESC = """
TONE-SPECIFIC:
- Select moments that spark scientific awe or curiosity: clear explanations, surprising discoveries, elegant analogies, or milestone findings across any scientific field (space/astronomy, biology, chemistry, physics, or other disciplines).
- `reason` must start "science because ..." and specify the key insight, principle, or breakthrough (e.g., scale, counterintuitive result, experiment, explanation, discovery).
- `quote` must capture the core scientific insight or the most striking line.
- Exclude rambling fact lists, vague generalizations, or speculation presented as certainty.
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

CONSPIRACY_PROMPT_DESC = """
TONE-SPECIFIC:
- Identify provocative or controversial claims that suggest hidden motives or secret plots.
- `reason` must start "conspiracy because ..." and name the claim or device (hidden agenda, cover-up, manipulation, secret knowledge).
- `quote` captures the core conspiratorial assertion or key phrase.
- Exclude baseless speculation presented as fact, hateful rhetoric, or unfounded accusations.
"""

POLITICS_PROMPT_DESC = """
TONE-SPECIFIC:
- Extract concise, self-contained beats that explain a policy, decision, vote, or outcome with clear stakes and who/what/why.
- `reason` must start "politics because ..." and name the civic relevance (policy impact, accountability, precedent, process clarified, bipartisan moment).
- `quote` captures the clearest, non-sensational line that states the claim, decision, or consequence.
- Exclude campaign slogans, personal attacks, horse‑race chatter, or unverified claims; flag uncertainty if the speaker speculates.
"""

SCIENCE_RATING_DESCRIPTIONS = {
    "10": "jaw-dropping breakthrough or explanation; unforgettable sense of clarity or wonder",
    "9":  "profound and memorable; crisp explanation or striking discovery with clear insight",
    "8":  "very strong; sparks curiosity and delivers a clear, engaging scientific takeaway",
    "7":  "good; informative and relevant with a decent hook",
    "6":  "borderline; needs tighter framing, clearer takeaway, or better grounding",
    "5":  "weak; facts or data points with little context or no clear point",
    "4":  "poor; meandering jargon, unclear framing, or partial claims",
    "3":  "confusing or unfocused; audience left without a clear idea",
    "2":  "not usable; speculative or off-topic without evidence",
    "1":  "not usable; misleading, trivial, or shoddy science",
    "0":  "reject; unsafe misinformation, pseudoscience, or sensational claims without evidence",
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

CONSPIRACY_RATING_DESCRIPTIONS = {
    "10": "compelling and well-articulated claim; clear connection and strong impact",
    "9":  "very provocative; clear framing and memorable",
    "8":  "engaging; plausible within context but requires scrutiny",
    "7":  "interesting; some gaps or weaker evidence",
    "6":  "borderline; speculative or lacking clarity",
    "5":  "weak; unclear or unsupported claim",
    "4":  "poor; confusing or overly vague",
    "3":  "poor; off-topic or misleading",
    "2":  "not usable; baseless speculation or irrelevant",
    "1":  "not usable; unfounded accusations or harmful rhetoric",
    "0":  "reject; hateful, dangerous, or blatantly false content",
}

POLITICS_RATING_DESCRIPTIONS = {
    "10": "civics gold; crystal‑clear stakes, impartial framing, memorable takeaway",
    "9":  "excellent; sharp explanation with concrete impact and minimal spin",
    "8":  "very good; clear context and relevance",
    "7":  "good; useful but could be tighter or less verbose",
    "6":  "borderline; missing key context or overly procedural",
    "5":  "weak; vague, partisan framing, or low impact",
    "4":  "poor; meandering or mostly horse‑race",
    "3":  "poor; off‑topic or confusing",
    "2":  "not usable; speculative or misleading framing",
    "1":  "not usable; inflammatory rhetoric without substance",
    "0":  "reject; hateful content or blatant misinformation",
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
        "- Stay within the current window shown; do not start before or end after the window. If a moment would cross a window boundary, SPLIT it at natural sentence/silence points so each clip fits entirely inside this window (and does not overlap with other clips).\n"
        "- No overlaps\n"
        "- Quote must be inside [start,end]; reason cites only lines within that span.\n"
        "- Valid values: start < end; start >= 0; rating is a decimal number within allowed range. No NaN/Infinity.\n"
        "- If any rule cannot be met perfectly, return [].\n\n"
        # "RATING SCALE:\n"
        # "- Use these rating descriptions to decide scores.\n"
        # f"{rating_descriptions or GENERAL_RATING_DESCRIPTIONS}\n\n"
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
    "SCIENCE_PROMPT_DESC",
    "HISTORY_PROMPT_DESC",
    "TECH_PROMPT_DESC",
    "HEALTH_PROMPT_DESC",
    "CONSPIRACY_PROMPT_DESC",
    "POLITICS_PROMPT_DESC",
    "GENERAL_RATING_DESCRIPTIONS",
    "FUNNY_RATING_DESCRIPTIONS",
    "SCIENCE_RATING_DESCRIPTIONS",
    "HISTORY_RATING_DESCRIPTIONS",
    "TECH_RATING_DESCRIPTIONS",
    "HEALTH_RATING_DESCRIPTIONS",
    "CONSPIRACY_RATING_DESCRIPTIONS",
    "POLITICS_RATING_DESCRIPTIONS",
    "_build_system_instructions",
    "build_window_prompt",
]
