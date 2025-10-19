from __future__ import annotations

from pathlib import Path

import pytest

from server.layouts import LayoutIdentifier
from server.layouts.registry import LayoutRegistry


@pytest.fixture()
def registry(tmp_path: Path) -> LayoutRegistry:
    built_in = Path("server/layouts/built-in").resolve()
    custom = tmp_path / "custom"
    return LayoutRegistry(built_in, custom)


def test_registry_lists_builtin_layouts(registry: LayoutRegistry) -> None:
    summaries = registry.list_layouts()
    keys = {summary.identifier.as_key() for summary in summaries}
    assert "built_in:centered" in keys
    assert "built_in:no_zoom" in keys


def test_sorted_video_cuts_respect_z_index(registry: LayoutRegistry) -> None:
    spec = registry.load(LayoutIdentifier(kind="built_in", name="centered_with_corners"))
    ordered = [cut.id for cut in spec.sorted_video_cuts()]
    assert ordered == ["main", "bottom_left", "bottom_right"]


def test_resolution_lookup_defaults_to_canvas_default(registry: LayoutRegistry) -> None:
    spec = registry.load(LayoutIdentifier(kind="built_in", name="centered"))
    preferred = spec.resolution_for("720x1280")
    assert preferred.width == 720
    assert preferred.height == 1280
    fallback = spec.resolution_for("unknown")
    assert fallback.id == spec.canvas.default_resolution_id


def test_import_export_roundtrip(registry: LayoutRegistry, tmp_path: Path) -> None:
    payload = {
        "metadata": {
            "id": "custom_layout",
            "name": "Custom Layout",
            "description": "Example custom layout for testing",
            "version": 1,
            "author": "pytest",
            "tags": ["test"],
        },
        "canvas": {
            "aspect_ratio": {"width": 9, "height": 16},
            "resolutions": [
                {"id": "1080p", "width": 1080, "height": 1920},
            ],
            "default_resolution_id": "1080p",
            "margins": {"top": 16, "right": 16, "bottom": 16, "left": 16},
            "padding": {"top": 8, "right": 8, "bottom": 8, "left": 8},
            "background": {"mode": "transparent", "opacity": 1.0},
        },
        "video_cuts": [
            {
                "id": "primary",
                "label": "Primary view",
                "source_rect": {"x": 0.0, "y": 0.0, "width": 1.0, "height": 1.0},
                "target_rect": {"x": 0.1, "y": 0.1, "width": 0.8, "height": 0.8},
                "border_radius": 12,
                "scale_mode": "cover",
                "z_index": 0,
            }
        ],
        "overlays": [],
    }

    identifier = registry.import_layout("custom_test", payload)
    stored_path = tmp_path / "custom" / "custom_test.json"
    assert stored_path.exists()

    exported = registry.export_layout(identifier)
    assert exported["metadata"]["id"] == "custom_layout"
    assert exported["canvas"]["default_resolution_id"] == "1080p"
    assert exported["video_cuts"][0]["target_rect"]["width"] == pytest.approx(0.8)
