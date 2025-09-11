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
    WINDOW_CONTEXT_PCT,
)

FUNNY_PROMPT_DESC = """
Find self-contained funny beats that will make most viewers laugh.

What to prefer:
- Short setups with a clear punchline or twist (deadpan contradiction, playful roast, absurd confession, misdirection, escalation, wordplay).
- Strange, out-of-the-blue, or jump‑cut moments that land a punchline (e.g., a sudden cut to an absurd confession).
- Clips where the comedic device is obvious (dry satire, slapstick, dark humor, etc.).

What to return:
- A single atomic joke beat per item: setup → brief escalation → punchline.
- Start slightly before the setup line and end just after the laugh/beat lands (≤ 1.5s of tail).
- Include 1–3s of pre‑punchline context only if needed for the joke to land.

Safety/allowances:
- Edgy or raunchy humor is allowed and should be scored when it delivers a witty payoff.
- Discard only when the content is hateful, non‑consensual, or purely offensive without wit.

Reason/quote/tags rules:
- `quote` must capture the punchline or exact comedic turn verbatim.
- `reason` must begin with 'funny because …', name the device (e.g., misdirection, roast, escalation), and explain why it lands.
- `tags` must include at least one comedic device (e.g., "punchline", "roast", "callback", "absurdity", "wordplay", "misdirection", "deadpan", "escalation") and optionally a style tag (e.g., "slapstick", "dark").

Reject:
- Long rambles, setup‑only segments, inside jokes that require unseen visuals, polite chuckles with no payoff, sponsor/promotional reads, or mean‑spirited/hateful remarks without wit.
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
Find mind‑expanding astronomy or spaceflight beats that trigger awe and curiosity.

What to prefer:
- Surprising facts, crisp explanations of cosmic phenomena, or consequential mission milestones (firsts, failures with insight, dramatic course corrections).
- Clear scale analogies, vivid numbers (distances, timescales), or counterintuitive corrections to common misconceptions.

What to return:
- Self‑contained moments with just enough context to understand the phenomenon and why it matters, ending on a memorable takeaway or image.
- Structure: clear claim or question → concise explanation/analogy → satisfying mini‑conclusion.

Reason/quote/tags rules:
- `quote` captures the core awe/insight line verbatim.
- `reason` begins with 'space awe because …' and explains why the moment inspires awe/curiosity and names the key insight.
- `tags` include a topic/device like "black holes", "analogy", "mission update", "scale", "explanation".

Reject:
- Rambling fact lists, context with no takeaway, overly technical math without a punchy insight, sponsor/CTA content, or speculation framed as certainty.
"""

HISTORY_PROMPT_DESC = """
Find consequential, easy-to-follow history beats that feel like crisp mini‑stories — interesting **or** significant.

What to prefer:
- Decision points, last‑minute reversals, firsts/lasts, declassified reveals, or mistaken assumptions exposed.
- Clear stakes and consequences that matter beyond trivia (policy shifts, wars, tech breakthroughs, social change, precedent‑setting rulings).
- Verifiable details: named actors, concrete dates/places, primary‑source mentions (e.g., memo, diary, dispatch), or quantified impact.

What to return:
- A self‑contained mini‑narrative: who/when/where in a phrase → pivot (decision/accident/reveal) → consequence/lesson/irony.
- Include only the context needed for the payoff; end on the twist, lesson, or quotable line. Keep it atomic (one beat).

Reason/quote/tags rules:
- `quote` captures the twist/decision line or the most quotable sentence that anchors the beat.
- `reason` begins with 'history because …' and names the stakes and the device (e.g., turning point, irony, first/last, declassification, misconception corrected). If a claim is debated or uncertain in the transcript, acknowledge that ("history because … tentative/contested").
- `tags` include 1–3 topical/device tags like "turning point", "ww2", "reform", "declassified", "trial", "treaty", "invention", "misconception".

Guardrails:
- Prefer clips that stand without visuals; avoid segments that require unseen maps/documents to make sense.
- Do not present myths as facts. If the speaker frames a legend/counterfactual, it must be labeled as such in the `reason`.
- Avoid modern partisan hot‑takes or moralizing without evidence; focus on events, decisions, and sourced claims.

Reject:
- Date‑dumps with no through‑line; lists of rulers/battles without a point; pure speculation framed as certainty; sponsor/CTA; or moralizing with no evidence.
"""

TECH_PROMPT_DESC = """
Find practical or eye‑opening technology beats that deliver clear value quickly.

What to prefer:
- Actionable tips, clean explanations of how something works, crisp comparisons, grounded takes on industry shifts (with trade‑offs).

What to return:
- Self‑contained clips that define the thing in plain language, show the why (benefit/risk), and land a take‑away the viewer can use or remember.
- Structure: hook claim/question → concise explanation/demo → punchy takeaway (rule of thumb, gotcha, or decision criterion).

Reason/quote/tags rules:
- `quote` captures the core takeaway or most memorable claim.
- `reason` begins with 'tech because …' and spells out the practical insight or trade‑off.
- `tags` include topic/device like "ai", "benchmark", "how‑it‑works", "tradeoff", "tip".

Reject:
- Vague hype, product pitches, endless caveats without guidance, sponsor/CTA content, or arguments that hinge on missing visuals/private context.
"""

HEALTH_PROMPT_DESC = """
Find engaging, responsible health or wellness beats that offer clear, evidence‑aware takeaways.

What to prefer:
- Actionable tips, careful myth‑busting, or simple frameworks ("if X then consider Y") that respect safety and individual variability.

What to return:
- Self‑contained clips that define terms plainly, cite the type of evidence when stated (e.g., RCT vs. anecdote), and finish with a conservative, useful takeaway.
- Structure: hook (question/misconception/everyday pain) → short explanation with guardrails → specific next step or heuristic.

Reason/quote/tags rules:
- `quote` captures the key advice or myth‑busting line.
- `reason` begins with 'health because …' and clarifies the takeaway or myth‑bust and why it is responsible guidance.
- `tags` include a topic/device like "sleep", "myth‑bust", "habit", "nutrition", "safety".

Reject:
- Medical claims without support, unsafe instructions, overconfident prescriptions, sponsor/CTA content, or shaming language.
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
        "You will extract high-quality, self-contained moments from a transcript. Follow these instructions exactly.\n\n"
        "OUTPUT FORMAT (strict):\n"
        "Return ONLY a valid JSON array, no prose, matching this schema:\n"
        "[{\"start\": number, \"end\": number, \"rating\": number, \"reason\": string, \"quote\": string, \"tags\": string[]}]\n\n"
        f"Duration: each item must be between {MIN_DURATION_SECONDS:.0f} "
        f"and {MAX_DURATION_SECONDS:.0f} seconds; ideal is "
        f"{SWEET_SPOT_MIN_SECONDS:.0f}–{SWEET_SPOT_MAX_SECONDS:.0f} seconds. "
        f"Items longer than {MAX_DURATION_SECONDS:.0f} seconds are invalid "
        "and must be discarded.\n"
        "Atomicity: return atomic beats, not segments that span multiple topics. If a strong moment would exceed the limit, SPLIT it into multiple adjacent items, each meeting the duration rules.\n"
        f"Window sanity: never output a clip longer than the current transcript window (≈{WINDOW_SIZE_SECONDS:.0f}s). If your best option is long, break it into multiple candidates.\n"
        "If no suitable moments exist, return [].\n\n"
        "HARD RULES (must all be satisfied):\n"
        f"- Clip length: {MIN_DURATION_SECONDS:.0f}–{MAX_DURATION_SECONDS:.0f}s only; strongly prefer {SWEET_SPOT_MIN_SECONDS:.0f}–{SWEET_SPOT_MAX_SECONDS:.0f}s. "
        f"Never output a clip longer than {MAX_DURATION_SECONDS:.0f}s or longer than the current window (≈{WINDOW_SIZE_SECONDS:.0f}s). When in doubt, split long material into smaller, self‑contained beats.\n"
        "- Self-contained: clear beginning and end; no missing context.\n"
        "- Boundaries: never start mid-word; begin at a natural lead-in and end just after the key beat lands (leave ~0.2–0.6s of tail room); prefer entering at the hook when possible. Always end at the end of a full sentence, not mid-thought.\n"
        "- Hook priority: the first 1–2 seconds must contain a clear hook (surprising line, bold claim, sharp question, or punchy setup). Trim silence/filler; avoid slow ramps. Prefer entering on the hook rather than several seconds of preamble; generic 'hook' alone is not a valid reason.\n"
        "- Split vs. combine: do NOT merge multiple punchlines or topics into one candidate. Prefer multiple short, self‑contained clips over one long clip.\n"
        "- Intro music: if there is intro music or a theme song at the start, begin the clip after the intro; never include music-only intros.\n"
        f"- Valid values: start < end; start ≥ 0; rating is a number {RATING_MIN:.1f}–{RATING_MAX:.1f} with one decimal place or more (e.g., 5.2, 6.7, 9.1). Do not restrict to .0 endings — use fractional decimals for nuance. No NaN/Infinity.\n"
        "- Quote fidelity: `quote` must appear within [start, end] and capture the core line.\n"
        "- Reason coverage: `start` and `end` must include all lines cited in `reason`; don't cite outside lines.\n"
        "- Tone-anchored reason: `reason` must explain how the moment fits the tone "
        "and start '<tone> because …' (e.g., 'funny because …', 'space awe because "
        "…', 'history because …', 'tech because …', 'health because …'); be "
        "concrete and name the device/insight (e.g., misdirection, scale analogy, "
        "turning point, trade-off, guardrail).\n"
        "- Quote alignment: `quote` must capture a line that showcases that tone. "
        "For FUNNY, use the punchline or precise comedic turn; for other tones, "
        "use the core claim/insight that the `reason` cites.\n"
        "- No generic reasons: never use vague labels like 'hook', 'good intro', 'nice debate', or 'interesting'. Reasons must explicitly reference why the moment fits the chosen tone (e.g., 'funny because … misdirection', 'history because … turning point').\n"
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
        "- Partial thoughts that end before the key beat/payoff.\n"
        "- Generic hooks or meta-chatter presented as reasons (e.g., 'this introduces the segment', 'we start the challenge now').\n\n"
        "SCORING GUIDE (general):\n"
        + "\n".join([f"{rating}: {desc}" for rating, desc in GENERAL_RATING_DESCRIPTIONS.items()])
        + ("\n\nTONE-SPECIFIC NOTES:\n" + "\n".join([f"{rating}: {desc}" for rating, desc in rating_descriptions.items()]) if rating_descriptions else "")
        + "\n\n"
        "Scores above 8 are reserved for truly standout clips; when uncertain, "
        "default to a lower score.\n"
        "Retention bias: when two candidates are similar, prefer the one with a tighter runtime and a stronger first 2–3 seconds.\n\n"
        "INSTRUCTIONS SOURCE (for context, not a style target):\n"
        f"{prompt_desc}\n"
        "Return the JSON now.\n"
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
    context_secs = WINDOW_SIZE_SECONDS * WINDOW_CONTEXT_PCT
    return (
        f"{system_instructions}\n\n"
        f"TRANSCRIPT WINDOW (≈{WINDOW_SIZE_SECONDS:.0f}s, "
        f"overlap {WINDOW_OVERLAP_SECONDS:.0f}s, context {context_secs:.0f}s):\n{text}\n\n"
        "Return JSON now."
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
