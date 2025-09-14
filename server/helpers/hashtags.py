from __future__ import annotations

"""LLM-backed hashtag generation utilities."""

import re
from typing import List, Optional

import config
from helpers.ai import local_llm_call_json, local_llm_generate
from common.caption_utils import build_hashtag_prompt, coerce_hashtag_list


def generate_hashtag_strings(
    title: str,
    quote: Optional[str] = None,
    show: Optional[str] = None,
    *,
    model: Optional[str] = None,
) -> List[str]:
    """Generate hashtag strings via the configured LLM.

    Attempts to parse a JSON array from the model. If parsing fails, falls back to
    tokenising the raw response. Returns a list of candidate hashtag strings.
    """

    prompt = build_hashtag_prompt(title=title, quote=quote, show=show)
    use_model = model or config.LOCAL_LLM_MODEL
    try:
        items = local_llm_call_json(
            model=use_model,
            prompt=prompt,
            options={"temperature": 0.0},
        )
    except Exception:
        raw = local_llm_generate(
            model=use_model,
            prompt=prompt,
            json_format=False,
            options={"temperature": 0.0},
        )
        tokens = re.findall(r"[0-9A-Za-z]+", raw)
        items = [{"text": t} for t in tokens]
    return coerce_hashtag_list(items)


__all__ = ["generate_hashtag_strings"]
