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

FUNNY_PROMPT_DESC = (
    "Find self-contained funny beats that will make most viewers laugh. Edgy, inappropriate, or raunchy humor is allowed and should be scored if it delivers a comedic payoff. Only discard when the content is hateful, non-consensual, or purely offensive without wit. Embrace strange, out-of-the-blue, or jump-cut moments if they land a punchline (e.g., sudden cut to an absurd confession). Prefer short setups with a clear punchline or twist (deadpan contradiction, playful roast, absurd confession, misdirection, escalation, wordplay). Highlight the comedic style (dry satire, slapstick, dark humor, etc.) when obvious and make the scenario's twist or contrast explicit. Structure each beat with setup, escalation, and punchline; pacing matters. The punchline must occur inside the clip window; do not return pure setup. Start slightly before the setup line and end just after the laugh/beat lands (≤1.5s). Include 1–3s of pre-punchline context when needed for the joke to land. Cues that often mark a punchline: audience laughter/(\"laughs\"), sudden contradiction (\"actually…\"), hyperbole or absurd comparisons, unexpected specifics, or a sharp reversal (\"turns out…\"). Your `quote` must capture the punchline line verbatim (or the exact comedic turn). Your `reason` must begin with 'funny because …' and name the device (e.g., misdirection, roast, escalation) and why it lands. `tags` must include at least one comedic device: [\"punchline\", \"roast\", \"callback\", \"absurdity\", \"wordplay\", \"misdirection\", \"deadpan\", \"escalation\"]; when possible add a tag for comedic style (e.g., \"slapstick\", \"dark\"). Reject: long rambles, setup-only segments, inside jokes that need unseen visuals, polite chuckles with no payoff, sponsor/promotional reads, or mean-spirited or hateful remarks without wit."
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

SPACE_PROMPT_DESC = (
    "Find mind-expanding astronomy or spaceflight beats that trigger awe and curiosity. "
    "Prefer surprising facts, crisp explanations of cosmic phenomena, or mission milestones that feel consequential (e.g., firsts, failures with insight, dramatic course corrections). "
    "Keep clips self-contained: give just enough context to understand the phenomenon and why it matters, then land a memorable takeaway or image. "
    "Structure each beat with a clear claim or question, a concise explanation/analogy, and a satisfying mini-conclusion. "
    "Cues of strong moments: vivid scale analogies, clear numbers (distances, timescales), comparisons to everyday objects, breakthroughs/\"we finally\" statements, high-stakes mission updates, or counterintuitive corrections (common misconceptions). "
    "Your `quote` should capture the core awe/insight line verbatim. "
    "Your `reason` must begin with 'space awe because …' and highlight why the moment inspires awe or curiosity and note the key insight. "
    "`tags` should include a topic or device (e.g., [\"black holes\", \"analogy\", \"mission update\", \"scale\", \"explanation\"]). "
    "Reject: rambling catalogues of facts, context that never lands a takeaway, overly technical math without a punchy insight, sponsor/CTA content, or speculation framed as certainty."
)

HISTORY_PROMPT_DESC = (
    "Find compelling historical beats that feel like crisp mini-stories. "
    "Prefer vivid anecdotes, sharp cause-and-effect, or surprising connections to the present. "
    "Keep clips self-contained: establish who/when/where in a phrase or two, highlight the twist or decision point, and conclude with the consequence or lesson. "
    "Structure: setup (context), pivot (decision, accident, reveal), and payoff (result, lesson, irony). "
    "Cues of strong moments: unlikely alliances, last-minute reversals, quotes from principals, declassified details, mistaken assumptions exposed, or numbers that reframe the scale of events. "
    "Your `quote` should capture the twist or most quotable line. "
    "Your `reason` must begin with 'history because …' and explain the historical stakes or irony that make the moment compelling. "
    "`tags` should include event/topic or device (e.g., [\"ww2\", \"turning point\", \"irony\", \"primary source\", \"consequence\"]). "
    "Reject: date-dumps without narrative, lists of rulers/battles with no through-line, myth repeated without caveat, sponsor/CTA content, or moralizing without evidence."
)

TECH_PROMPT_DESC = (
    "Find practical or eye-opening technology beats that deliver clear value quickly. "
    "Prefer actionable tips, clean explanations of how something works, crisp comparisons, or grounded takes on industry shifts (trade-offs included). "
    "Keep clips self-contained: define the thing in plain language, show the why (benefit or risk), and land a take-away the viewer could use or remember. "
    "Structure: hook claim/question, concise explanation/demo, and punchy takeaway (rule of thumb, gotcha, or decision criterion). "
    "Cues of strong moments: counterintuitive benchmarks, before/after demos, minimal repro steps, pros/cons in one breath, cost/time trade-offs, or clarified misconceptions. "
    "Your `quote` should capture the core takeaway or the most memorable claim. "
    "Your `reason` must begin with 'tech because …' and spell out the practical insight or trade-off that defines the moment. "
    "`tags` should include topic or device (e.g., [\"ai\", \"benchmark\", \"how-it-works\", \"tradeoff\", \"tip\"]). "
    "Reject: vague hype, product pitches, endless caveats without guidance, sponsor/CTA content, or arguments that hinge on missing visuals or private context."
)

HEALTH_PROMPT_DESC = (
    "Find engaging, responsible health or wellness beats that offer clear, evidence-aware takeaways. "
    "Prefer actionable tips, myth-busting with nuance, or simple frameworks (\"if X then consider Y\") that respect safety and individual variability. "
    "Keep clips self-contained: define terms plainly, cite the type of evidence when stated (e.g., RCT vs. anecdote), and finish with a conservative, useful takeaway. "
    "Structure: hook (question, misconception, or everyday pain), short explanation with guardrails, and a specific next step or heuristic. "
    "Cues of strong moments: quantified effects, practical substitutions, dose/frequency clarity, common pitfalls, or \"red flag\" checks. "
    "Your `quote` should capture the key advice or myth-busting line. "
    "Your `reason` must begin with 'health because …' and clarify the health takeaway or myth-bust and why it is responsible guidance. "
    "`tags` should include topic or device (e.g., [\"sleep\", \"myth-bust\", \"habit\", \"nutrition\", \"safety\"]). "
    "Reject: medical claims without support, unsafe instructions, overconfident prescriptions, sponsor/CTA content, or shaming language."
)

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
    "10": "mini-epic; perfect twist/payoff with crisp context",
    "9":  "excellent story; memorable and insightful",
    "8":  "very good; clear narrative and point",
    "7":  "good; solid anecdote with acceptable context",
    "6":  "borderline; needs clearer stakes or payoff",
    "5":  "weak; dates/facts but no story",
    "4":  "poor; disjointed or confusing",
    "3":  "poor; off-track or trivial",
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
        f"Duration: each item must be between {MIN_DURATION_SECONDS:.0f} and {MAX_DURATION_SECONDS:.0f} seconds; ideal is {SWEET_SPOT_MIN_SECONDS:.0f}–{SWEET_SPOT_MAX_SECONDS:.0f} seconds.\n"
        "If no suitable moments exist, return [].\n\n"
        "HARD RULES (must all be satisfied):\n"
        "- Self-contained: clear beginning and end; no missing context.\n"
        "- Boundaries: never start mid-word; begin at a natural lead-in and end just after the key beat lands (leave ~0.2–0.6s of tail room); prefer entering at the hook when possible. Always end at the end of a full sentence, not mid-thought.\n"
        "- Hook priority: the first 1–2 seconds must contain a clear hook (surprising line, bold claim, sharp question, or punchy setup). Trim silence/filler; avoid slow ramps. Prefer entering on the hook rather than several seconds of preamble; generic 'hook' alone is not a valid reason.\n"
        "- Intro music: if there is intro music or a theme song at the start, begin the clip after the intro; never include music-only intros.\n"
        f"- Valid values: start < end; start ≥ 0; rating is a number {RATING_MIN:.1f}–{RATING_MAX:.1f} with one decimal place or more (e.g., 5.2, 6.7, 9.1). Do not restrict to .0 endings — use fractional decimals for nuance. No NaN/Infinity.\n"
        "- Quote fidelity: `quote` must appear within [start, end] and capture the core line.\n"
        "- Reason coverage: `start` and `end` must include all lines cited in `reason`; don't cite outside lines.\n"
        "- Tone-anchored reason: start `reason` with '<tone> because …' (e.g., 'funny because …', 'space awe because …', 'history because …', 'tech because …', 'health because …'). Be concrete and name the device/insight (e.g., misdirection, scale analogy, turning point, trade-off, guardrail).\n"
        "- Quote alignment: for FUNNY, `quote` must be the punchline or the precise comedic turn; for other tones, it must be the core claim/insight that the `reason` cites.\n"
        "- No generic reasons: never use vague labels like 'Hook', 'good intro', 'nice debate', or 'interesting'; reasons must reference why the moment fits the chosen tone.\n"
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
        "default to a lower score.\n\n"
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
