from __future__ import annotations

from typing import Dict

from .base import RenderLayout
from .centered_zoom import CenteredZoomLayout
from .no_zoom import NoZoomLayout
from .left_aligned_zoom import LeftAlignedZoomLayout

__all__ = [
    "RenderLayout",
    "CenteredZoomLayout",
    "NoZoomLayout",
    "LeftAlignedZoomLayout",
    "get_layout",
]


_LAYOUTS: Dict[str, RenderLayout] = {
    "centered": CenteredZoomLayout(),
    "no_zoom": NoZoomLayout(),
    "left_aligned": LeftAlignedZoomLayout(),
}


def get_layout(name: str) -> RenderLayout:
    """Return a render layout by name.

    Falls back to the centered layout when the name is unknown.
    """
    return _LAYOUTS.get(name, _LAYOUTS["centered"])
