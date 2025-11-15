from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Iterable, Mapping, Sequence

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


class LayoutNotFoundError(FileNotFoundError):
    """Raised when a layout with the requested identifier cannot be located."""


class LayoutValidationError(ValueError):
    """Raised when a layout JSON payload fails validation."""


def _candidate_roots() -> list[Path]:
    roots: list[Path] = []
    seen: set[Path] = set()

    def add(path: Path) -> None:
        try:
            resolved = path.expanduser().resolve()
        except Exception:
            return
        if not resolved.exists() or not resolved.is_dir():
            return
        if resolved in seen:
            return
        seen.add(resolved)
        roots.append(resolved)

    env = os.environ.get("ATROPOS_LAYOUTS_ROOT")
    if env:
        add(Path(env))
    out_root_env = os.environ.get("OUT_ROOT")
    if out_root_env:
        out_root = Path(out_root_env).expanduser().resolve()
        add(out_root.parent / "layouts")
    package_root = Path(__file__).resolve().parents[2] / "layouts"
    add(package_root)
    return roots


def list_layout_files(category: str) -> list[Path]:
    files: list[Path] = []
    for root in _candidate_roots():
        category_dir = root / category
        if not category_dir.exists():
            continue
        for path in sorted(category_dir.glob("*.json")):
            if path.is_file():
                files.append(path)
    return files


def _parse_float(value: object, default: float = 0.0) -> float:
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        try:
            return float(value)
        except ValueError as exc:  # pragma: no cover - validation guard
            raise LayoutValidationError(f"Expected numeric value, received '{value}'") from exc
    return default


def _parse_int(value: object, default: int = 0) -> int:
    if isinstance(value, bool):
        return int(value)
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(value)
    if isinstance(value, str):
        try:
            return int(float(value))
        except ValueError as exc:  # pragma: no cover - validation guard
            raise LayoutValidationError(f"Expected integer value, received '{value}'") from exc
    return default


def _parse_frame(payload: Mapping[str, object]) -> LayoutFrame:
    try:
        return LayoutFrame(
            x=_parse_float(payload.get("x", 0.0)),
            y=_parse_float(payload.get("y", 0.0)),
            width=_parse_float(payload.get("width", 1.0)),
            height=_parse_float(payload.get("height", 1.0)),
        ).clamp()
    except LayoutValidationError:
        raise
    except Exception as exc:  # pragma: no cover - defensive
        raise LayoutValidationError("Invalid frame specification") from exc


def _parse_crop(payload: Mapping[str, object] | None) -> LayoutCrop | None:
    if not payload:
        return None
    units = payload.get("units", "fraction")
    if units not in ("fraction", "pixels"):
        raise LayoutValidationError(f"Unsupported crop units '{units}'")
    return LayoutCrop(
        x=_parse_float(payload.get("x", 0.0)),
        y=_parse_float(payload.get("y", 0.0)),
        width=_parse_float(payload.get("width", 1.0)),
        height=_parse_float(payload.get("height", 1.0)),
        units=units,  # type: ignore[arg-type]
    )


def _parse_background(payload: Mapping[str, object] | None) -> LayoutBackground:
    if not payload:
        return LayoutBackground(kind="blur", radius=45, opacity=0.6, brightness=0.55)
    kind = str(payload.get("kind", "blur"))
    if kind not in {"blur", "color", "image"}:
        raise LayoutValidationError(f"Unknown background kind '{kind}'")
    background = LayoutBackground(kind=kind)
    if kind == "blur":
        background.radius = _parse_int(payload.get("radius", 45))
        background.opacity = _parse_float(payload.get("opacity", 0.6))
        background.brightness = _parse_float(payload.get("brightness", 0.55))
        background.saturation = _parse_float(payload.get("saturation", 1.0))
    elif kind == "color":
        color = payload.get("color", "#000000")
        if not isinstance(color, str):
            raise LayoutValidationError("Background color must be a string")
        background.color = color
        background.opacity = _parse_float(payload.get("opacity", 1.0))
    elif kind == "image":
        source = payload.get("source")
        if not isinstance(source, str) or not source:
            raise LayoutValidationError("Image background requires a source path")
        background.source = source
        mode = payload.get("mode")
        if mode is not None and mode not in ("cover", "contain"):
            raise LayoutValidationError(f"Unsupported background mode '{mode}'")
        background.mode = mode  # type: ignore[assignment]
        tint = payload.get("tint")
        if tint is not None and not isinstance(tint, str):
            raise LayoutValidationError("Background tint must be a string when provided")
        background.tint = tint  # type: ignore[assignment]
    return background


def _parse_caption_area(payload: Mapping[str, object] | None) -> LayoutCaptionArea | None:
    if not payload:
        return None
    frame = _parse_frame(payload)
    align = payload.get("align", "center")
    if align not in ("left", "center", "right"):
        raise LayoutValidationError(f"Unsupported caption alignment '{align}'")
    max_lines = payload.get("maxLines")
    if max_lines is None:
        max_lines = payload.get("max_lines")
    max_lines_value = None
    if max_lines is not None:
        max_lines_value = _parse_int(max_lines)
        if max_lines_value <= 0:
            max_lines_value = None
    wrap_width = payload.get("wrapWidth")
    if wrap_width is None:
        wrap_width = payload.get("wrap_width")
    wrap_value = None
    if wrap_width is not None:
        wrap_value = _parse_float(wrap_width)
    return LayoutCaptionArea(frame=frame, align=align, max_lines=max_lines_value, wrap_width=wrap_value)


def _parse_video_item(payload: Mapping[str, object]) -> LayoutVideoItem:
    frame = _parse_frame(payload.get("frame", {}))
    crop = _parse_crop(payload.get("crop"))
    scale_mode = str(payload.get("scaleMode", payload.get("scale_mode", "cover")))
    if scale_mode not in {"cover", "contain", "fill"}:
        raise LayoutValidationError(f"Unsupported scaleMode '{scale_mode}'")
    rotation = payload.get("rotation")
    rotation_value = None
    if rotation is not None:
        rotation_value = _parse_float(rotation)
    opacity = payload.get("opacity")
    opacity_value = None
    if opacity is not None:
        opacity_value = max(0.0, min(1.0, _parse_float(opacity)))
    mirror = bool(payload.get("mirror", False))
    z_index = _parse_int(payload.get("zIndex", payload.get("z_index", 0)))
    name_value = payload.get("name")
    name = str(name_value) if isinstance(name_value, str) else None
    source = payload.get("source", "primary")
    if source != "primary":
        raise LayoutValidationError(f"Unsupported video source '{source}'")
    return LayoutVideoItem(
        id=str(payload.get("id", "video")),
        kind="video",
        source="primary",
        name=name,
        frame=frame,
        crop=crop,
        scale_mode=scale_mode,  # type: ignore[arg-type]
        rotation=rotation_value,
        opacity=opacity_value,
        mirror=mirror,
        z_index=z_index,
    )


def _parse_text_item(payload: Mapping[str, object]) -> LayoutTextItem:
    frame = _parse_frame(payload.get("frame", {}))
    content = payload.get("content", payload.get("text", ""))
    if not isinstance(content, str):
        raise LayoutValidationError("Text content must be a string")
    align = payload.get("align", "center")
    if align not in ("left", "center", "right"):
        raise LayoutValidationError(f"Unsupported text alignment '{align}'")
    color = payload.get("color")
    if color is not None and not isinstance(color, str):
        raise LayoutValidationError("Text colour must be a string")
    font_family = payload.get("fontFamily")
    if font_family is None:
        font_family = payload.get("font_family")
    if font_family is not None and not isinstance(font_family, str):
        raise LayoutValidationError("fontFamily must be a string")
    font_size = payload.get("fontSize")
    if font_size is None:
        font_size = payload.get("font_size")
    font_size_value = _parse_float(font_size, 16.0) if font_size is not None else None
    font_weight = payload.get("fontWeight")
    if font_weight is None:
        font_weight = payload.get("font_weight")
    if font_weight not in (None, "normal", "bold"):
        raise LayoutValidationError(f"Unsupported font weight '{font_weight}'")
    letter_spacing = payload.get("letterSpacing")
    if letter_spacing is None:
        letter_spacing = payload.get("letter_spacing")
    letter_spacing_value = _parse_float(letter_spacing) if letter_spacing is not None else None
    line_height = payload.get("lineHeight")
    if line_height is None:
        line_height = payload.get("line_height")
    line_height_value = _parse_float(line_height) if line_height is not None else None
    uppercase = bool(payload.get("uppercase", False))
    opacity = payload.get("opacity")
    opacity_value = None
    if opacity is not None:
        opacity_value = max(0.0, min(1.0, _parse_float(opacity)))
    z_index = _parse_int(payload.get("zIndex", payload.get("z_index", 0)))
    return LayoutTextItem(
        id=str(payload.get("id", "text")),
        kind="text",
        content=content,
        frame=frame,
        align=align,  # type: ignore[arg-type]
        color=color,
        font_family=font_family,
        font_size=font_size_value,
        font_weight=font_weight,  # type: ignore[arg-type]
        letter_spacing=letter_spacing_value,
        line_height=line_height_value,
        uppercase=uppercase,
        opacity=opacity_value,
        z_index=z_index,
    )


def _parse_shape_item(payload: Mapping[str, object]) -> LayoutShapeItem:
    frame = _parse_frame(payload.get("frame", {}))
    color = payload.get("color", "#000000")
    if not isinstance(color, str):
        raise LayoutValidationError("Shape colour must be a string")
    border_radius = _parse_float(payload.get("borderRadius", payload.get("border_radius", 0.0)))
    opacity = _parse_float(payload.get("opacity", 1.0))
    z_index = _parse_int(payload.get("zIndex", payload.get("z_index", 0)))
    return LayoutShapeItem(
        id=str(payload.get("id", "shape")),
        kind="shape",
        frame=frame,
        color=color,
        border_radius=border_radius,
        opacity=opacity,
        z_index=z_index,
    )


def _parse_item(payload: Mapping[str, object]) -> LayoutItem:
    kind = str(payload.get("kind", "video"))
    if kind == "video":
        return _parse_video_item(payload)
    if kind == "text":
        return _parse_text_item(payload)
    if kind == "shape":
        return _parse_shape_item(payload)
    raise LayoutValidationError(f"Unsupported layout item kind '{kind}'")


def _parse_items(payload: Iterable[object]) -> list[LayoutItem]:
    items: list[LayoutItem] = []
    for entry in payload:
        if isinstance(entry, Mapping):
            items.append(_parse_item(entry))
    return items


def _parse_canvas(payload: Mapping[str, object] | None) -> LayoutCanvas:
    width = 1080
    height = 1920
    background_payload: Mapping[str, object] | None = None
    if payload:
        width = max(1, _parse_int(payload.get("width", width)))
        height = max(1, _parse_int(payload.get("height", height)))
        background_raw = payload.get("background")
        if isinstance(background_raw, Mapping):
            background_payload = background_raw
    return LayoutCanvas(width=width, height=height, background=_parse_background(background_payload))


def _load_json(path: Path) -> Mapping[str, object]:
    try:
        raw = path.read_text(encoding="utf-8")
    except OSError as exc:  # pragma: no cover - filesystem guard
        raise LayoutValidationError(f"Unable to read layout '{path}'") from exc
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise LayoutValidationError(f"Layout '{path.name}' contains invalid JSON") from exc
    if not isinstance(payload, Mapping):
        raise LayoutValidationError("Layout root must be an object")
    return payload


def load_layout_from_path(path: Path, *, category: str | None = None) -> LayoutDefinition:
    payload = _load_json(path)
    layout_id = str(payload.get("id", path.stem))
    name = str(payload.get("name", layout_id))
    version = _parse_int(payload.get("version", 1))
    description = payload.get("description")
    author = payload.get("author")
    tags_payload = payload.get("tags", [])
    tags: tuple[str, ...]
    if isinstance(tags_payload, Sequence) and not isinstance(tags_payload, (str, bytes)):
        tags = tuple(str(tag) for tag in tags_payload if isinstance(tag, str))
    else:
        tags = tuple()
    canvas = _parse_canvas(payload.get("canvas") if isinstance(payload.get("canvas"), Mapping) else None)
    caption_area = _parse_caption_area(payload.get("captionArea") if isinstance(payload.get("captionArea"), Mapping) else payload.get("caption_area") if isinstance(payload.get("caption_area"), Mapping) else None)
    items_payload = payload.get("items", [])
    if not isinstance(items_payload, Sequence):
        raise LayoutValidationError("Layout items must be an array")
    items = _parse_items(items_payload)
    created_at = payload.get("createdAt") or payload.get("created_at")
    if created_at is not None and not isinstance(created_at, str):
        created_at = None
    updated_at = payload.get("updatedAt") or payload.get("updated_at")
    if updated_at is not None and not isinstance(updated_at, str):
        updated_at = None
    definition = LayoutDefinition(
        id=layout_id,
        name=name,
        version=version,
        description=str(description) if isinstance(description, str) else None,
        author=str(author) if isinstance(author, str) else None,
        tags=tags,
        canvas=canvas,
        caption_area=caption_area,
        items=items,
        created_at=created_at,
        updated_at=updated_at,
        source_path=path,
    )
    if category in {"builtin", "custom"}:
        # attach category metadata if the caller wants to build a summary later
        pass
    return definition


def list_layouts() -> list[LayoutSummary]:
    seen: dict[str, LayoutSummary] = {}
    for category in ("custom", "builtin"):
        for path in list_layout_files(category):
            try:
                definition = load_layout_from_path(path, category=category)
            except LayoutValidationError:
                continue
            summary = LayoutSummary(
                id=definition.id,
                name=definition.name,
                description=definition.description,
                author=definition.author,
                category=category,  # type: ignore[arg-type]
                path=path,
                tags=tuple(definition.tags),
                updated_at=definition.updated_at,
            )
            seen.setdefault(summary.id, summary)
    return sorted(seen.values(), key=lambda summary: (summary.category, summary.name.lower()))


def load_layout(layout_id: str) -> LayoutDefinition:
    for category in ("custom", "builtin"):
        for path in list_layout_files(category):
            if path.stem == layout_id:
                return load_layout_from_path(path, category=category)
            try:
                payload = _load_json(path)
            except LayoutValidationError:
                continue
            candidate_id = payload.get("id")
            if isinstance(candidate_id, str) and candidate_id == layout_id:
                return load_layout_from_path(path, category=category)
    raise LayoutNotFoundError(layout_id)


__all__ = [
    "LayoutNotFoundError",
    "LayoutValidationError",
    "list_layouts",
    "load_layout",
    "load_layout_from_path",
]
