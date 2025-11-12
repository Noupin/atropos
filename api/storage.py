from __future__ import annotations

import base64
import json
import secrets
from typing import Dict, Iterable, List

from api.settings import StorageSettings


def ensure_initialized(settings: StorageSettings) -> None:
    settings.subscribers_file.parent.mkdir(parents=True, exist_ok=True)
    settings.unsub_tokens_file.parent.mkdir(parents=True, exist_ok=True)
    if not settings.subscribers_file.exists():
        settings.subscribers_file.write_text("[]", encoding="utf-8")
    if not settings.unsub_tokens_file.exists():
        settings.unsub_tokens_file.write_text("{}", encoding="utf-8")


def load_subscribers(settings: StorageSettings) -> List[str]:
    try:
        data = settings.subscribers_file.read_text(encoding="utf-8")
    except OSError:
        return []
    try:
        parsed = json.loads(data)
    except json.JSONDecodeError:
        return []
    if isinstance(parsed, list):
        return [value for value in parsed if isinstance(value, str)]
    return []


def save_subscribers(settings: StorageSettings, subscribers: Iterable[str]) -> None:
    unique = sorted(set(subscribers))
    payload = json.dumps(unique, ensure_ascii=False, indent=2)
    settings.subscribers_file.write_text(payload, encoding="utf-8")


def load_unsubscribe_tokens(settings: StorageSettings) -> Dict[str, str]:
    try:
        data = settings.unsub_tokens_file.read_text(encoding="utf-8")
    except OSError:
        return {}
    try:
        parsed = json.loads(data)
    except json.JSONDecodeError:
        return {}
    if isinstance(parsed, dict):
        return {
            str(key): str(value)
            for key, value in parsed.items()
            if isinstance(key, str) and isinstance(value, str)
        }
    return {}


def save_unsubscribe_tokens(settings: StorageSettings, tokens: Dict[str, str]) -> None:
    payload = json.dumps(tokens, ensure_ascii=False, indent=2)
    settings.unsub_tokens_file.write_text(payload, encoding="utf-8")


def generate_unsubscribe_token() -> str:
    token = base64.urlsafe_b64encode(secrets.token_bytes(24))
    return token.rstrip(b"=").decode("ascii")
