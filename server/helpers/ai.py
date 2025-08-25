import json
import os
import re
import time
from typing import Callable, Any, Optional, Dict, List

import requests
from requests.exceptions import RequestException

# Default URL for a local Ollama server. Can be overridden via environment.
OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://localhost:11434")

# Regex to salvage the first JSON array from a response.
DEFAULT_JSON_EXTRACT = re.compile(r"\[(?:.|\n)*\]")


def ollama_generate(
    model: str,
    prompt: str,
    json_format: bool = True,
    options: Optional[dict] = None,
    timeout: int = 120,
) -> str:
    """Call Ollama's /api/generate endpoint.

    Returns the raw response string.
    """
    payload = {
        "model": model,
        "prompt": prompt,
        "stream": False,
    }
    if json_format:
        payload["format"] = "json"
    if options:
        payload["options"] = options
    url = f"{OLLAMA_URL}/api/generate"
    resp = requests.post(url, json=payload, timeout=timeout)
    resp.raise_for_status()
    data = resp.json()
    return data.get("response", "").strip()


def ollama_call_json(
    model: str,
    prompt: str,
    *,
    options: Optional[dict] = None,
    timeout: int = 120,
    extract_re: re.Pattern[str] = DEFAULT_JSON_EXTRACT,
) -> List[Dict]:
    """Call Ollama and return parsed JSON array with robust fallback."""
    try:
        raw = ollama_generate(
            model=model,
            prompt=prompt,
            json_format=True,
            options=options,
            timeout=timeout,
        )
    except RequestException as e:
        raise RuntimeError(f"Ollama request failed: {e}")
    try:
        parsed = json.loads(raw)
        if isinstance(parsed, dict) and "items" in parsed:
            parsed = parsed["items"]
        if isinstance(parsed, list):
            return parsed
    except Exception:
        pass
    m = extract_re.search(raw)
    if not m:
        raise ValueError(f"Model did not return JSON array. Raw head: {raw[:300]}")
    return json.loads(m.group(0))


def retry(fn: Callable[[], Any], *, attempts: int = 3, backoff: float = 1.5):
    """Retry ``fn`` up to ``attempts`` times with exponential backoff."""
    last_exc = None
    for i in range(attempts):
        try:
            return fn()
        except Exception as e:
            last_exc = e
            if i == attempts - 1:
                break
            time.sleep(backoff ** i)
    raise last_exc


__all__ = [
    "ollama_generate",
    "ollama_call_json",
    "retry",
]
