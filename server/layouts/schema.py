from __future__ import annotations

from enum import Enum
from typing import Literal, Sequence

from pydantic import BaseModel, Field, field_validator, model_validator


class AspectRatio(BaseModel):
    """Aspect ratio expressed as width and height components."""

    width: int = Field(..., gt=0)
    height: int = Field(..., gt=0)

    @field_validator("width", "height")
    @classmethod
    def _positive(cls, value: int) -> int:
        if value <= 0:
            raise ValueError("Aspect ratio components must be positive integers")
        return value

    def normalised(self) -> tuple[int, int]:
        from math import gcd

        divisor = gcd(self.width, self.height)
        if divisor <= 0:
            return self.width, self.height
        return self.width // divisor, self.height // divisor


class Resolution(BaseModel):
    """Concrete resolution supported by a layout."""

    id: str = Field(..., min_length=1)
    width: int = Field(..., gt=0)
    height: int = Field(..., gt=0)
    label: str | None = None

    @model_validator(mode="after")
    def _sync_label(self) -> "Resolution":
        if not self.label:
            self.label = f"{self.width}×{self.height}"
        return self

    def aspect_ratio(self) -> AspectRatio:
        return AspectRatio(width=self.width, height=self.height)


class Insets(BaseModel):
    """Padding or margin configuration in pixels."""

    top: float = 0.0
    right: float = 0.0
    bottom: float = 0.0
    left: float = 0.0

    @field_validator("top", "right", "bottom", "left")
    @classmethod
    def _non_negative(cls, value: float) -> float:
        if value < 0:
            raise ValueError("Insets cannot be negative")
        return float(value)


class Rect(BaseModel):
    """Rectangle expressed as ratios within [0, 1]."""

    x: float = Field(..., ge=0.0, le=1.0)
    y: float = Field(..., ge=0.0, le=1.0)
    width: float = Field(..., ge=0.0, le=1.0)
    height: float = Field(..., ge=0.0, le=1.0)

    @model_validator(mode="after")
    def _bounds(self) -> "Rect":
        if self.x + self.width > 1.0 + 1e-6:
            raise ValueError("Rect extends beyond horizontal bounds")
        if self.y + self.height > 1.0 + 1e-6:
            raise ValueError("Rect extends beyond vertical bounds")
        return self


class BackgroundMode(str, Enum):
    VIDEO_BLUR = "video_blur"
    SOLID_COLOR = "solid_color"
    TRANSPARENT = "transparent"


class BackgroundConfig(BaseModel):
    mode: BackgroundMode = BackgroundMode.VIDEO_BLUR
    color: tuple[int, int, int] | None = Field(default=None, description="Solid colour in BGR order")
    blur_radius: int | None = Field(
        default=None,
        ge=1,
        description="Gaussian blur radius to apply when using video blur",
    )
    opacity: float = Field(default=1.0, ge=0.0, le=1.0)

    @model_validator(mode="after")
    def _validate_color(self) -> "BackgroundConfig":
        if self.mode == BackgroundMode.SOLID_COLOR:
            if self.color is None:
                raise ValueError("Solid colour backgrounds must define a colour")
        return self


class ScaleMode(str, Enum):
    COVER = "cover"
    CONTAIN = "contain"
    STRETCH = "stretch"


class VideoCutSpec(BaseModel):
    """Describes a portion of the original video to render in the layout."""

    id: str = Field(..., min_length=1)
    label: str | None = None
    source_rect: Rect = Field(..., description="Region of the original frame to sample")
    target_rect: Rect = Field(..., description="Destination rectangle on the canvas")
    border_radius: float = Field(default=0.0, ge=0.0)
    scale_mode: ScaleMode = ScaleMode.COVER
    z_index: int = 0


class FontWeight(str, Enum):
    NORMAL = "normal"
    MEDIUM = "medium"
    SEMIBOLD = "semibold"
    BOLD = "bold"


class TextAlignment(str, Enum):
    LEFT = "left"
    CENTER = "center"
    RIGHT = "right"


class TextOverlaySpec(BaseModel):
    id: str = Field(..., min_length=1)
    text: str = Field(..., min_length=1)
    target_rect: Rect
    font_family: str = "Inter"
    font_size: float = Field(default=28.0, gt=0.0)
    font_weight: FontWeight = FontWeight.SEMIBOLD
    line_height: float = Field(default=1.1, gt=0.5)
    color: tuple[int, int, int] = (255, 255, 255)
    alignment: TextAlignment = TextAlignment.CENTER
    z_index: int = 100
    shadow: bool = True


class OverlaySpec(BaseModel):
    type: Literal["text"] = "text"
    text: TextOverlaySpec


class LayoutMetadata(BaseModel):
    id: str = Field(..., min_length=1)
    name: str = Field(..., min_length=1)
    description: str | None = None
    version: int = 1
    author: str | None = None
    tags: list[str] = Field(default_factory=list)


class LayoutCanvas(BaseModel):
    aspect_ratio: AspectRatio
    resolutions: list[Resolution]
    default_resolution_id: str
    margins: Insets = Insets()
    padding: Insets = Insets()
    background: BackgroundConfig = BackgroundConfig()

    @model_validator(mode="after")
    def _validate_resolution(self) -> "LayoutCanvas":
        if not self.resolutions:
            raise ValueError("Layouts must expose at least one resolution")
        ids = {res.id for res in self.resolutions}
        if self.default_resolution_id not in ids:
            raise ValueError("Default resolution must exist in resolution list")
        return self


class LayoutSpec(BaseModel):
    metadata: LayoutMetadata
    canvas: LayoutCanvas
    video_cuts: list[VideoCutSpec]
    overlays: list[OverlaySpec] = Field(default_factory=list)

    def resolution_for(self, resolution_id: str | None) -> Resolution:
        if resolution_id:
            for item in self.canvas.resolutions:
                if item.id == resolution_id:
                    return item
        for item in self.canvas.resolutions:
            if item.id == self.canvas.default_resolution_id:
                return item
        return self.canvas.resolutions[0]

    def sorted_video_cuts(self) -> Sequence[VideoCutSpec]:
        return sorted(self.video_cuts, key=lambda spec: spec.z_index)

    def sorted_overlays(self) -> Sequence[OverlaySpec]:
        return sorted(self.overlays, key=lambda spec: spec.text.z_index)
