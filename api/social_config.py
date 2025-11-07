from __future__ import annotations

"""Configuration helpers for social account aggregation."""

import json
import os
from functools import lru_cache
from typing import Any, Dict


DEFAULT_SOCIAL_HANDLES: Dict[str, list[str]] = {
    "youtube": [
        "SniplyFunnyKinda",
        "SniplyCosmos",
        "SniplyHistory",
        "SniplySecrets",
        "SniplyHealth",
    ],
    "instagram": [
        "SniplyFunnyKinda",
        "SniplyCosmos",
        "SniplyHistory",
        "SniplySecrets",
        "SniplyHealth",
    ],
    "tiktok": [],
    "facebook": [],
}


DEFAULT_PLATFORM_FLAGS: Dict[str, bool] = {
    "youtube": True,
    "instagram": True,
    "tiktok": False,
    "facebook": False,
}


def _load_json_env(name: str) -> Any:
    raw = os.environ.get(name)
    if not raw:
        return None
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return None


@lru_cache(maxsize=1)
def get_social_handles() -> Dict[str, list[str]]:
    """Return configured social handles keyed by platform."""

    overrides = _load_json_env("SOCIAL_HANDLES")
    if isinstance(overrides, dict):
        handles: Dict[str, list[str]] = {}
        for key, value in overrides.items():
            if isinstance(value, list):
                handles[key] = [str(item).strip() for item in value if str(item).strip()]
        merged = {key: list(values) for key, values in DEFAULT_SOCIAL_HANDLES.items()}
        merged.update({k: v for k, v in handles.items()})
        return merged
    return {key: list(values) for key, values in DEFAULT_SOCIAL_HANDLES.items()}


@lru_cache(maxsize=1)
def get_platform_flags() -> Dict[str, bool]:
    """Return platform enablement flags for the web surface."""

    overrides = _load_json_env("ENABLE_SOCIAL_PLATFORMS")
    if isinstance(overrides, dict):
        resolved = DEFAULT_PLATFORM_FLAGS.copy()
        for key, value in overrides.items():
            if isinstance(value, bool):
                resolved[key] = value
            elif isinstance(value, str):
                lowered = value.lower()
                if lowered in {"1", "true", "yes", "on"}:
                    resolved[key] = True
                elif lowered in {"0", "false", "no", "off"}:
                    resolved[key] = False
        return resolved
    return DEFAULT_PLATFORM_FLAGS


@lru_cache(maxsize=1)
def get_social_config() -> Dict[str, Any]:
    """Expose a merged configuration payload for client consumption."""

    handles = get_social_handles()
    flags = get_platform_flags()
    platforms: Dict[str, Dict[str, Any]] = {}
    for platform, platform_handles in handles.items():
        platforms[platform] = {
            "enabled": bool(flags.get(platform, False)),
            "handles": platform_handles,
        }
    return {
        "handles": handles,
        "platforms": platforms,
        "flags": flags,
    }

