from __future__ import annotations

from dataclasses import dataclass

from .models import LayoutDefinition, LayoutVideoItem, LayoutTextItem, LayoutShapeItem, LayoutCrop


@dataclass(slots=True)
class PixelRect:
    x: int
    y: int
    width: int
    height: int

    def clamp(self, max_width: int, max_height: int) -> PixelRect:
        x = max(0, min(self.x, max_width))
        y = max(0, min(self.y, max_height))
        width = max(0, min(self.width, max_width))
        height = max(0, min(self.height, max_height))
        if x + width > max_width:
            width = max_width - x
        if y + height > max_height:
            height = max_height - y
        return PixelRect(x=x, y=y, width=width, height=height)


@dataclass(slots=True)
class PreparedVideoItem:
    item: LayoutVideoItem
    target: PixelRect
    crop: LayoutCrop | None


@dataclass(slots=True)
class PreparedTextItem:
    item: LayoutTextItem
    target: PixelRect


@dataclass(slots=True)
class PreparedShapeItem:
    item: LayoutShapeItem
    target: PixelRect


@dataclass(slots=True)
class PreparedLayout:
    definition: LayoutDefinition
    width: int
    height: int
    videos: tuple[PreparedVideoItem, ...]
    texts: tuple[PreparedTextItem, ...]
    shapes: tuple[PreparedShapeItem, ...]
    caption_rect: PixelRect | None
    caption_align: str | None
    caption_max_lines: int | None
    caption_wrap_width: float | None


def _to_pixel_rect(width: int, height: int, x: float, y: float, rect_width: float, rect_height: float) -> PixelRect:
    return PixelRect(
        x=int(round(x * width)),
        y=int(round(y * height)),
        width=int(round(rect_width * width)),
        height=int(round(rect_height * height)),
    ).clamp(width, height)


def _prepare_video_item(item: LayoutVideoItem, canvas_width: int, canvas_height: int) -> PreparedVideoItem:
    frame = item.frame
    target = _to_pixel_rect(canvas_width, canvas_height, frame.x, frame.y, frame.width, frame.height)
    return PreparedVideoItem(item=item, target=target, crop=item.crop)


def _prepare_text_item(item: LayoutTextItem, canvas_width: int, canvas_height: int) -> PreparedTextItem:
    frame = item.frame
    target = _to_pixel_rect(canvas_width, canvas_height, frame.x, frame.y, frame.width, frame.height)
    return PreparedTextItem(item=item, target=target)


def _prepare_shape_item(item: LayoutShapeItem, canvas_width: int, canvas_height: int) -> PreparedShapeItem:
    frame = item.frame
    target = _to_pixel_rect(canvas_width, canvas_height, frame.x, frame.y, frame.width, frame.height)
    return PreparedShapeItem(item=item, target=target)


def prepare_layout(definition: LayoutDefinition) -> PreparedLayout:
    canvas_width = max(1, int(definition.canvas.width))
    canvas_height = max(1, int(definition.canvas.height))

    videos: list[PreparedVideoItem] = []
    texts: list[PreparedTextItem] = []
    shapes: list[PreparedShapeItem] = []

    for item in definition.items:
        if isinstance(item, LayoutVideoItem):
            videos.append(_prepare_video_item(item, canvas_width, canvas_height))
        elif isinstance(item, LayoutTextItem):
            texts.append(_prepare_text_item(item, canvas_width, canvas_height))
        elif isinstance(item, LayoutShapeItem):
            shapes.append(_prepare_shape_item(item, canvas_width, canvas_height))

    videos.sort(key=lambda prepared: prepared.item.z_index)
    texts.sort(key=lambda prepared: prepared.item.z_index)
    shapes.sort(key=lambda prepared: prepared.item.z_index)

    caption_rect = None
    caption_align = None
    caption_max_lines = None
    caption_wrap_width = None
    if definition.caption_area is not None:
        area = definition.caption_area
        caption_rect = _to_pixel_rect(canvas_width, canvas_height, area.frame.x, area.frame.y, area.frame.width, area.frame.height)
        caption_align = area.align
        caption_max_lines = area.max_lines
        caption_wrap_width = area.wrap_width

    return PreparedLayout(
        definition=definition,
        width=canvas_width,
        height=canvas_height,
        videos=tuple(videos),
        texts=tuple(texts),
        shapes=tuple(shapes),
        caption_rect=caption_rect,
        caption_align=caption_align,
        caption_max_lines=caption_max_lines,
        caption_wrap_width=caption_wrap_width,
    )


__all__ = [
    "PixelRect",
    "PreparedLayout",
    "PreparedShapeItem",
    "PreparedTextItem",
    "PreparedVideoItem",
    "prepare_layout",
]
