"""Utilities for working with JSON-defined video layouts."""

from .loader import (
    LayoutNotFoundError,
    LayoutValidationError,
    list_layouts,
    load_layout,
    load_layout_from_path,
)
from .models import (
    LayoutBackground,
    LayoutCanvas,
    LayoutCaptionArea,
    LayoutCrop,
    LayoutDefinition,
    LayoutFrame,
    LayoutItem,
    LayoutShapeItem,
    LayoutSummary,
    LayoutTextItem,
    LayoutVideoItem,
)
from .runtime import (
    PixelRect,
    PreparedLayout,
    PreparedShapeItem,
    PreparedTextItem,
    PreparedVideoItem,
    prepare_layout,
)

__all__ = [
    "LayoutBackground",
    "LayoutCanvas",
    "LayoutCaptionArea",
    "LayoutCrop",
    "LayoutDefinition",
    "LayoutFrame",
    "LayoutItem",
    "LayoutNotFoundError",
    "LayoutShapeItem",
    "LayoutSummary",
    "LayoutTextItem",
    "LayoutValidationError",
    "LayoutVideoItem",
    "PixelRect",
    "PreparedLayout",
    "PreparedShapeItem",
    "PreparedTextItem",
    "PreparedVideoItem",
    "list_layouts",
    "load_layout",
    "load_layout_from_path",
    "prepare_layout",
]
