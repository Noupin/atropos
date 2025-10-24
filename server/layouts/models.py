from __future__ import annotations

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal, Sequence


Number = float | int


@dataclass(slots=True)
class LayoutFrame:
    """Normalised rectangle within the layout canvas."""

    x: float
    y: float
    width: float
    height: float

    def clamp(self) -> LayoutFrame:
        return LayoutFrame(
            x=min(max(self.x, 0.0), 1.0),
            y=min(max(self.y, 0.0), 1.0),
            width=min(max(self.width, 0.0), 1.0),
            height=min(max(self.height, 0.0), 1.0),
        )


@dataclass(slots=True)
class LayoutCrop:
    """Crop rectangle applied to a source frame.

    When ``units`` is ``fraction`` the coordinates are normalised in the range ``[0, 1]``.
    When ``units`` is ``pixels`` they map directly to source pixels.
    """

    x: float
    y: float
    width: float
    height: float
    units: Literal["fraction", "pixels"] = "fraction"


@dataclass(slots=True)
class LayoutBackground:
    kind: Literal["blur", "color", "image"]
    radius: int | None = None
    opacity: float | None = None
    brightness: float | None = None
    saturation: float | None = None
    color: str | None = None
    source: str | None = None
    mode: Literal["cover", "contain"] | None = None
    tint: str | None = None


@dataclass(slots=True)
class LayoutCaptionArea:
    frame: LayoutFrame
    align: Literal["left", "center", "right"] = "center"
    max_lines: int | None = None
    wrap_width: float | None = None


@dataclass(slots=True)
class LayoutVideoItem:
    id: str
    kind: Literal["video"]
    source: Literal["primary"] = "primary"
    name: str | None = None
    frame: LayoutFrame = field(default_factory=lambda: LayoutFrame(0, 0, 1, 1))
    crop: LayoutCrop | None = None
    scale_mode: Literal["cover", "contain", "fill"] = "cover"
    rotation: Number | None = None
    opacity: float | None = None
    mirror: bool = False
    z_index: int = 0


@dataclass(slots=True)
class LayoutTextItem:
    id: str
    kind: Literal["text"]
    content: str
    frame: LayoutFrame
    align: Literal["left", "center", "right"] = "center"
    color: str | None = None
    font_family: str | None = None
    font_size: Number | None = None
    font_weight: Literal["normal", "bold"] | None = None
    letter_spacing: Number | None = None
    line_height: Number | None = None
    uppercase: bool = False
    opacity: float | None = None
    z_index: int = 0


@dataclass(slots=True)
class LayoutShapeItem:
    id: str
    kind: Literal["shape"]
    frame: LayoutFrame
    color: str = "#000000"
    border_radius: float = 0.0
    opacity: float = 1.0
    z_index: int = 0


LayoutItem = LayoutVideoItem | LayoutTextItem | LayoutShapeItem


@dataclass(slots=True)
class LayoutCanvas:
    width: int
    height: int
    background: LayoutBackground


@dataclass(slots=True)
class LayoutDefinition:
    id: str
    name: str
    version: int
    description: str | None = None
    author: str | None = None
    tags: Sequence[str] = field(default_factory=tuple)
    canvas: LayoutCanvas = field(
        default_factory=lambda: LayoutCanvas(1080, 1920, LayoutBackground(kind="blur"))
    )
    caption_area: LayoutCaptionArea | None = None
    items: Sequence[LayoutItem] = field(default_factory=tuple)
    created_at: str | None = None
    updated_at: str | None = None
    source_path: Path | None = None


@dataclass(slots=True)
class LayoutSummary:
    id: str
    name: str
    description: str | None
    author: str | None
    category: Literal["builtin", "custom"]
    path: Path
    tags: Sequence[str] = field(default_factory=tuple)
    updated_at: str | None = None


__all__ = [
    "LayoutBackground",
    "LayoutCaptionArea",
    "LayoutCanvas",
    "LayoutCrop",
    "LayoutDefinition",
    "LayoutFrame",
    "LayoutItem",
    "LayoutShapeItem",
    "LayoutTextItem",
    "LayoutVideoItem",
    "LayoutSummary",
]
