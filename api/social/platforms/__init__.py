from __future__ import annotations

from typing import Callable, Dict

from api.social.context import PlatformContext
from api.social.exceptions import UnsupportedPlatformError
from api.social.models import AccountStats
from api.social.platforms import facebook, instagram, tiktok, youtube

Resolver = Callable[[str, PlatformContext], AccountStats]

_RESOLVERS: Dict[str, Resolver] = {
    "youtube": youtube.resolve,
    "instagram": instagram.resolve,
    "tiktok": tiktok.resolve,
    "facebook": facebook.resolve,
}


def get_resolver(platform: str) -> Resolver:
    try:
        return _RESOLVERS[platform]
    except KeyError as exc:
        raise UnsupportedPlatformError(f"Unsupported platform: {platform}") from exc


def supported_platforms() -> set[str]:
    return set(_RESOLVERS.keys())
