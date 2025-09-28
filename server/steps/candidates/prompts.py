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
- Identify a provocative or surprising comedic claim/turn that clearly signals the joke or device.
- `reason` must start "funny because ..." and name the device or claim (misdirection, roast, wordplay, escalation, deadpan, callback) and the logic that makes it land.
- `quote` captures the core comedic assertion or punchline with just enough setup to stand alone.
- Exclude hateful or non-consensual targets, or inside-baseball that lacks context.
"""


SCIENCE_PROMPT_DESC = """
TONE-SPECIFIC:
- Identify a clear scientific claim or explanation (principle, mechanism, experiment, discovery) that can stand alone for a layperson.
- `reason` must start "science because ..." and name the claim or device (mechanism, evidence, analogy) and the logic from setup to implication.
- `quote` captures the core scientific assertion or result with the minimal context needed.
- Exclude rambling fact lists or speculation presented as certainty.
"""

HISTORY_PROMPT_DESC = """
TONE-SPECIFIC:
- Identify a consequential historical claim (decision, reversal, first/last, declassification) with clear stakes.
- `reason` must start "history because ..." and name the claim or device (turning point, cause→effect, contested account) and the logic from action to outcome; mark disputed claims as tentative.
- `quote` captures the core historical assertion or twist with enough context.
- Exclude trivia lists, myths as facts, or partisan hot takes.
"""

TECH_PROMPT_DESC = """
TONE-SPECIFIC:
- Identify a practical technical claim or trade-off (how-it-works, constraint, step, pattern) that is reproducible.
- `reason` must start "tech because ..." and name the claim or device (constraint, trade-off, mechanism) and the logic from setup to consequence.
- `quote` captures the core technical assertion or actionable line with minimal context.
- Exclude vague hype, sales pitches, or unverifiable claims.
"""

HEALTH_PROMPT_DESC = """
TONE-SPECIFIC:
- Identify a careful health claim or guidance (myth-bust, risk/benefit, habit) with scope and safety.
- `reason` must start "health because ..." and name the claim or device (guideline, evidence type, contraindication) and the logic from advice to implication.
- `quote` captures the key health assertion with necessary context; avoid absolutes.
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
- Identify a civic claim about a policy, decision, vote, or process with clear stakes and actors.
- `reason` must start "politics because ..." and name the claim or device (policy impact, accountability, precedent, process clarified) and the logic from decision to consequence.
- `quote` captures the core civic assertion with sufficient context; avoid sensational framings.
- Exclude campaign slogans, personal attacks, horse-race chatter, or unverified claims.
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
