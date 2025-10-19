from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Iterator, Literal

from pydantic import ValidationError

from .schema import LayoutSpec, Resolution

LayoutKind = Literal["built_in", "custom"]


@dataclass(frozen=True)
class LayoutIdentifier:
    """Stable identifier for a layout entry."""

    kind: LayoutKind
    name: str

    def as_key(self) -> str:
        return f"{self.kind}:{self.name}"

    @staticmethod
    def parse(value: str) -> "LayoutIdentifier":
        try:
            kind, name = value.split(":", 1)
        except ValueError as exc:  # pragma: no cover - defensive branch
            raise ValueError(f"Invalid layout identifier '{value}'") from exc
        kind_value: LayoutKind
        if kind == "built_in":
            kind_value = "built_in"
        elif kind == "custom":
            kind_value = "custom"
        else:
            raise ValueError(f"Unsupported layout namespace '{kind}'")
        if not name:
            raise ValueError("Layout name cannot be empty")
        return LayoutIdentifier(kind=kind_value, name=name)


@dataclass(frozen=True)
class LayoutSummary:
    identifier: LayoutIdentifier
    title: str
    description: str | None
    resolutions: tuple[Resolution, ...]
    default_resolution: Resolution
    tags: tuple[str, ...]


class LayoutRegistry:
    """Coordinates layout discovery across built-in and custom directories."""

    def __init__(self, built_in_root: Path, custom_root: Path) -> None:
        self._built_in_root = built_in_root
        self._custom_root = custom_root
        self._built_in_root.mkdir(parents=True, exist_ok=True)
        self._custom_root.mkdir(parents=True, exist_ok=True)

    def _iter_sources(self) -> Iterator[tuple[LayoutKind, Path]]:
        for entry in sorted(self._built_in_root.glob("*.json")):
            if entry.is_file():
                yield "built_in", entry
        for entry in sorted(self._custom_root.glob("*.json")):
            if entry.is_file():
                yield "custom", entry

    def _name_for_path(self, path: Path) -> str:
        return path.stem.replace(" ", "_")

    def list_layouts(self) -> list[LayoutSummary]:
        layouts: list[LayoutSummary] = []
        for kind, path in self._iter_sources():
            try:
                spec = self._load_from_path(path)
            except ValidationError as exc:
                # Skip invalid entries but surface a summary placeholder
                title = path.stem
                layouts.append(
                    LayoutSummary(
                        identifier=LayoutIdentifier(kind=kind, name=self._name_for_path(path)),
                        title=title,
                        description=f"Invalid layout: {exc.errors()[0]['msg']}" if exc.errors() else "Invalid layout",
                        resolutions=tuple(),
                        default_resolution=_fallback_resolution(),
                        tags=tuple(),
                    )
                )
                continue
            identifier = LayoutIdentifier(kind=kind, name=self._name_for_path(path))
            default_resolution = spec.resolution_for(spec.canvas.default_resolution_id)
            layouts.append(
                LayoutSummary(
                    identifier=identifier,
                    title=spec.metadata.name,
                    description=spec.metadata.description,
                    resolutions=tuple(spec.canvas.resolutions),
                    default_resolution=default_resolution,
                    tags=tuple(spec.metadata.tags),
                )
            )
        return layouts

    def _path_for(self, identifier: LayoutIdentifier) -> Path:
        root = self._built_in_root if identifier.kind == "built_in" else self._custom_root
        return root / f"{identifier.name}.json"

    def _load_from_path(self, path: Path) -> LayoutSpec:
        payload = json.loads(path.read_text(encoding="utf-8"))
        return LayoutSpec.model_validate(payload)

    def load(self, identifier: LayoutIdentifier) -> LayoutSpec:
        path = self._path_for(identifier)
        if not path.exists():
            raise FileNotFoundError(f"Layout '{identifier.as_key()}' was not found at {path}")
        return self._load_from_path(path)

    def import_layout(self, name: str, payload: dict) -> LayoutIdentifier:
        identifier = LayoutIdentifier(kind="custom", name=name)
        spec = LayoutSpec.model_validate(payload)
        path = self._path_for(identifier)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(spec.model_dump(mode="json"), indent=2), encoding="utf-8")
        return identifier

    def export_layout(self, identifier: LayoutIdentifier) -> dict:
        spec = self.load(identifier)
        return spec.model_dump(mode="json")


def _fallback_resolution() -> Resolution:
    return Resolution(id="invalid", width=1080, height=1920)
