import json
import os
import platform
import re
import time
from typing import Any, Callable, Dict, List, Optional

import requests
from requests.exceptions import HTTPError, RequestException

from config import LLM_API_TIMEOUT

# Default URLs for local model servers. Can be overridden via environment.
OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://localhost:11434")
LMSTUDIO_URL = os.environ.get("LMSTUDIO_URL", "http://127.0.0.1:1234")

# Regex to salvage the first JSON array from a response.
DEFAULT_JSON_EXTRACT = re.compile(r"\[(?:.|\n)*\]")

# Determine which local LLM provider to use. Default to LM Studio on macOS.
LOCAL_LLM_PROVIDER = os.environ.get(
    "LOCAL_LLM_PROVIDER",
    "lmstudio" if platform.system() == "Darwin" else "ollama",
)


def ollama_generate(
    model: str,
    prompt: str,
    json_format: bool = True,
    options: Optional[dict] = None,
    timeout: int = LLM_API_TIMEOUT,
) -> str:
    """Call Ollama's /api/generate endpoint and return the raw response string."""
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
    timeout: int = LLM_API_TIMEOUT,
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


def lmstudio_generate(
    model: str,
    prompt: str,
    json_format: bool = True,
    options: Optional[dict] = None,
    timeout: int = LLM_API_TIMEOUT,
) -> str:
    """Call LM Studio's OpenAI compatible endpoint and return raw content."""
    payload: Dict[str, Any] = {
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
        "stream": False,
    }
    if json_format:
        payload["response_format"] = {"type": "json_object"}
    if options:
        payload.update(options)
    url = f"{LMSTUDIO_URL}/v1/chat/completions"
    resp = requests.post(url, json=payload, timeout=timeout)
    try:
        resp.raise_for_status()
    except HTTPError:
        if json_format and resp.status_code == 400 and "response_format" in payload:
            payload.pop("response_format", None)
            resp = requests.post(url, json=payload, timeout=timeout)
            resp.raise_for_status()
        else:
            raise
    data = resp.json()
    choices = data.get("choices", [])
    if not choices:
        return ""
    return choices[0].get("message", {}).get("content", "").strip()


def lmstudio_call_json(
    model: str,
    prompt: str,
    *,
    options: Optional[dict] = None,
    timeout: int = LLM_API_TIMEOUT,
    extract_re: re.Pattern[str] = DEFAULT_JSON_EXTRACT,
) -> List[Dict]:
    """Call LM Studio and return parsed JSON array with robust fallback."""
    try:
        raw = lmstudio_generate(
            model=model,
            prompt=prompt,
            json_format=True,
            options=options,
            timeout=timeout,
        )
    except RequestException as e:
        raise RuntimeError(f"LM Studio request failed: {e}")
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


def local_llm_call_json(
    model: str,
    prompt: str,
    *,
    options: Optional[dict] = None,
    timeout: int = LLM_API_TIMEOUT,
    extract_re: re.Pattern[str] = DEFAULT_JSON_EXTRACT,
) -> List[Dict]:
    """Call the configured local LLM provider and parse JSON array output."""
    if LOCAL_LLM_PROVIDER.lower() == "lmstudio":
        return lmstudio_call_json(
            model=model,
            prompt=prompt,
            options=options,
            timeout=timeout,
            extract_re=extract_re,
        )
    return ollama_call_json(
        model=model,
        prompt=prompt,
        options=options,
        timeout=timeout,
        extract_re=extract_re,
    )


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
            time.sleep(backoff**i)
    raise last_exc


__all__ = [
    "ollama_generate",
    "ollama_call_json",
    "lmstudio_generate",
    "lmstudio_call_json",
    "local_llm_call_json",
    "retry",
]
