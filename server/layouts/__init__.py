from __future__ import annotations

from pathlib import Path

from .registry import LayoutIdentifier, LayoutRegistry, LayoutSummary
from .schema import LayoutSpec

__all__ = [
    "LayoutIdentifier",
    "LayoutRegistry",
    "LayoutSummary",
    "LayoutSpec",
    "get_default_registry",
]


_registry: LayoutRegistry | None = None


def get_default_registry() -> LayoutRegistry:
    global _registry
    if _registry is None:
        root = Path(__file__).parent
        built_in = root / "built-in"
        custom = root / "custom"
        _registry = LayoutRegistry(built_in, custom)
    return _registry
