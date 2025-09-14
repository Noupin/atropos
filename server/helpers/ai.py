import json
import os
import re
import time
from typing import Any, Callable, Dict, List, Optional, Pattern

import requests
from requests.exceptions import HTTPError, RequestException

from config import LLM_API_TIMEOUT, LOCAL_LLM_PROVIDER

# Default URLs for local model servers. Can be overridden via environment.
OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://localhost:11434")
LMSTUDIO_URL = os.environ.get("LMSTUDIO_URL", "http://localhost:1234")

# Regex to salvage the first JSON array from a response.
DEFAULT_JSON_EXTRACT = re.compile(r"\[(?:.|\n)*\]")


# Some models occasionally emit stray control characters that break ``json.loads``.
# Strip all ASCII control characters before attempting to parse.
_CTRL_RE = re.compile(r"[\x00-\x1F]")
_NAN_INF_RE = re.compile(r"\b(?:NaN|Infinity|-Infinity)\b")

# Map common smart quotes to regular double quotes so ``json.loads`` succeeds.
_SMART_QUOTES = str.maketrans({
    "\u2018": '"',  # left single
    "\u2019": '"',  # right single
    "\u201C": '"',  # left double
    "\u201D": '"',  # right double
})


def _normalize_quotes(text: str) -> str:
    """Replace smart quotes with standard quotes."""

    return text.translate(_SMART_QUOTES)


def _strip_control_chars(text: str) -> str:
    return _CTRL_RE.sub("", text)


def _strip_code_fences(text: str) -> str:
    """Remove Markdown-style code fences from ``text`` if present."""

    if "```" not in text:
        return text
    return re.sub(r"```(?:json)?", "", text)


def _trim_edges(text: str) -> str:
    """Strip leading/trailing whitespace and control characters."""

    text = text.strip()
    while text and ord(text[0]) < 32:
        text = text[1:]
    while text and ord(text[-1]) < 32:
        text = text[:-1]
    return text


def _find_balanced_array(text: str) -> Optional[str]:
    """Return the longest balanced top-level JSON array substring."""

    in_single = False
    in_double = False
    escape = False
    depth = 0
    start = None
    best = ""
    for i, ch in enumerate(text):
        if escape:
            escape = False
            continue
        if ch == "\\":
            escape = True
            continue
        if in_single:
            if ch == "'":
                in_single = False
            continue
        if in_double:
            if ch == '"':
                in_double = False
            continue
        if ch == "'":
            in_single = True
            continue
        if ch == '"':
            in_double = True
            continue
        if ch == "[":
            if depth == 0:
                start = i
            depth += 1
            continue
        if ch == "]" and depth > 0:
            depth -= 1
            if depth == 0 and start is not None:
                cand = text[start : i + 1]
                if len(cand) > len(best):
                    best = cand
                start = None
    return best or None


def _fix_single_quotes(text: str) -> str:
    text = re.sub(r"'([^']+)'\s*:", r'"\1":', text)
    text = re.sub(r":\s*'([^']*)'", r':"\1"', text)
    return re.sub(r"'([^']*)'", r'"\1"', text)


def _remove_trailing_commas(text: str) -> str:
    return re.sub(r",\s*(\]|})", r"\1", text)


def _replace_nan_inf(text: str) -> str:
    text = re.sub(r"-?Infinity", "null", text)
    return re.sub(r"NaN", "null", text)


def _escape_ctrl_chars(text: str) -> str:
    def repl(match: re.Match[str]) -> str:
        ch = match.group(0)
        return f"\\u{ord(ch):04x}"

    return _CTRL_RE.sub(repl, text)


def _sanitize(text: str) -> str:
    text = _fix_single_quotes(text)
    text = _remove_trailing_commas(text)
    text = _replace_nan_inf(text)
    return _escape_ctrl_chars(text)


def coerce_json_array(raw: str, extract_re: Pattern[str]) -> str:
    """Attempt to extract and sanitize a JSON array from ``raw``."""

    text = _trim_edges(raw)
    text = _strip_code_fences(text)
    text = text.strip()

    if text.startswith("[") and text.endswith("]"):
        try:
            json.loads(text)
            if not _NAN_INF_RE.search(text):
                return text
        except Exception:
            pass

    matches = extract_re.findall(text)
    if matches:
        best = max(matches, key=len)
        try:
            json.loads(best)
            if not _NAN_INF_RE.search(best):
                return best
        except Exception:
            pass

    cand = _find_balanced_array(text)
    if cand:
        try:
            json.loads(cand)
            if not _NAN_INF_RE.search(cand):
                return cand
        except Exception:
            pass

    sanitized = _sanitize(text)
    if sanitized.startswith("[") and sanitized.endswith("]"):
        try:
            json.loads(sanitized)
            return sanitized
        except Exception:
            pass

    matches = extract_re.findall(sanitized)
    if matches:
        best = max(matches, key=len)
        try:
            json.loads(best)
            return best
        except Exception:
            pass

    cand = _find_balanced_array(sanitized)
    if cand:
        try:
            json.loads(cand)
            return cand
        except Exception:
            pass

    try:
        import json5  # type: ignore

        obj = json5.loads(sanitized)
        if isinstance(obj, list):
            return json.dumps(obj)
        if isinstance(obj, dict):
            if isinstance(obj.get("items"), list):
                return json.dumps(obj["items"])
            for value in obj.values():
                if isinstance(value, list):
                    return json.dumps(value)
    except Exception:
        pass

    raise ValueError(f"Model did not return JSON array. Raw head: {text[:300]}")


def _ensure_list_of_dicts(items: List[Any]) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for item in items:
        if isinstance(item, dict):
            out.append(item)
        elif isinstance(item, (list, tuple)):
            d: Dict[str, Any] = {}
            if len(item) > 0:
                d["start"] = item[0]
            if len(item) > 1:
                d["end"] = item[1]
            if len(item) > 2:
                d["text"] = item[2]
            out.append(d)
        else:
            out.append({"text": item})
    return out


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
    raw = data.get("response", "")
    if isinstance(raw, (dict, list)):
        raw = json.dumps(raw)
    return str(raw).strip()


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
        raw = _normalize_quotes(_strip_control_chars(raw))
    except RequestException as e:
        raise RuntimeError(f"Ollama request failed: {e}")
    try:
        parsed = json.loads(raw)
        if isinstance(parsed, list):
            return parsed
        if isinstance(parsed, dict):
            if isinstance(parsed.get("items"), list):
                return parsed["items"]
            for value in parsed.values():
                if isinstance(value, list):
                    return value
            return [parsed]
    except Exception:
        pass
    m = extract_re.search(raw)
    if not m:
        raise ValueError(f"Model did not return JSON array. Raw head: {raw[:300]}")
    return json.loads(_normalize_quotes(_strip_control_chars(m.group(0))))


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
        raw = _normalize_quotes(raw)
    except RequestException as e:
        raise RuntimeError(f"LM Studio request failed: {e}")

    try:
        coerced = coerce_json_array(raw, extract_re)
        parsed = json.loads(coerced)
    except Exception as e:
        head = raw[:300]
        raise ValueError(
            f"LM Studio model '{model}' did not return JSON array. Raw head: {head}"
        ) from e

    items: List[Any]
    if isinstance(parsed, list):
        items = parsed
    elif isinstance(parsed, dict):
        if isinstance(parsed.get("items"), list):
            items = parsed["items"]
        else:
            items = []
            for value in parsed.values():
                if isinstance(value, list):
                    items = value
                    break
            if not items:
                items = [parsed]
    else:
        items = [parsed]

    items = _ensure_list_of_dicts(items)
    return items


def local_llm_generate(
    model: str,
    prompt: str,
    *,
    options: Optional[dict] = None,
    timeout: int = LLM_API_TIMEOUT,
) -> str:
    """Call the configured local LLM provider and return raw text."""
    if LOCAL_LLM_PROVIDER.lower() == "lmstudio":
        return lmstudio_generate(
            model=model,
            prompt=prompt,
            json_format=False,
            options=options,
            timeout=timeout,
        )
    return ollama_generate(
        model=model,
        prompt=prompt,
        json_format=False,
        options=options,
        timeout=timeout,
    )


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
    "coerce_json_array",
    "ollama_generate",
    "ollama_call_json",
    "lmstudio_generate",
    "lmstudio_call_json",
    "local_llm_generate",
    "local_llm_call_json",
    "retry",
]
