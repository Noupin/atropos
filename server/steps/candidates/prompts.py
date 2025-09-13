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

def _build_system_instructions(
    prompt_desc: str
) -> str:
    return (
        "<start_of_turn>user\n"
        "Extract self-contained video clips from this transcript. Follow all rules exactly.\n\n"
        "OUTPUT (strict):\n"
        "- Must return exactly one valid JSON array. First char '[' and last char ']'.\n"
        "- RFC 8259 JSON: double-quoted keys/strings, commas between items, no trailing commas, no comments/markdown/backticks.\n"
        "- ASCII printable only (U+0020–U+007E). No emojis or smart quotes.\n\n"
        "SCHEMA (exact):\n"
        "[{\"start\": number, \"end\": number, \"rating\": number, \"reason\": string, \"quote\": string, \"tags\": string[]}]\n"
        "  (rating MUST always be in the range 1.0–10.0 with one decimal place; never use 0 or values <1).\n\n"
        "CLIP RULES:\n"
        f"- Clip length: {MIN_DURATION_SECONDS:.0f}-{MAX_DURATION_SECONDS:.0f}s. Respect both bounds strictly. "
        f"Stay in the {SWEET_SPOT_MIN_SECONDS:.0f}-{SWEET_SPOT_MAX_SECONDS:.0f}s sweet spot; "
        f"treat {SWEET_SPOT_MAX_SECONDS:.0f}s as a speed limit—only exceed it when a longer clip is exceptional and cannot be trimmed. "
        f"- Never output a clip shorter than {MIN_DURATION_SECONDS:.0f}s. If a moment is too short, include minimal natural lead‑in/out (not filler) so it clears {MIN_DURATION_SECONDS:.0f}s; otherwise omit it.\n"
        f"- Never output a clip longer than {MAX_DURATION_SECONDS:.0f}s. If a great moment exceeds {MAX_DURATION_SECONDS:.0f}s, SPLIT it into adjacent items, each within the limits.\n"
        "- Up to 6 items total.\n"
        "- reason <= 240 chars; quote <= 200 chars.\n"
        "- tags: 1-5 items; each <= 24 chars.\n"
        "- Atomic: one beat; begin on a natural lead-in; end right after the payoff.\n"
        "- Hook: a clear hook in the first ~2s; trim silence/filler.\n"
        f"- Do not round-trip your own durations: explicitly set `end - start` between {MIN_DURATION_SECONDS:.0f}s and {MAX_DURATION_SECONDS:.0f}s. If uncertain, adjust to the nearest natural boundary within that range (prefer shorter over longer if both valid).\n"
        "- Stay within the current window shown; do not start before or end after the window. If a moment would cross a window boundary, SPLIT it at natural sentence/silence points so each clip fits entirely inside this window (and does not overlap with other clips).\n"
        "- No overlaps\n"
        "- Quote must be inside [start,end]; reason cites only lines within that span.\n"
        "- Valid values: start < end; start >= 0; rating is a decimal number between 1.0 and 10.0 inclusive, with one decimal place. No 0 ratings, NaN, or Infinity.\n"
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
        prompt_desc
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
    "_build_system_instructions",
    "build_window_prompt",
]
