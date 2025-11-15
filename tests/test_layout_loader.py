from __future__ import annotations

import json
from pathlib import Path

import pytest

from server.layouts.loader import (
    LayoutNotFoundError,
    LayoutValidationError,
    list_layouts,
    load_layout,
    load_layout_from_path,
)


def test_load_builtin_layout_returns_definition() -> None:
    layout = load_layout("centered")
    assert layout.id == "centered"
    assert layout.canvas.width > 0
    assert layout.canvas.height > 0
    assert layout.items, "Expected built-in layout to contain at least one item"


def test_list_layouts_includes_custom_and_builtin(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    root = tmp_path / "layouts"
    (root / "custom").mkdir(parents=True)
    (root / "builtin").mkdir()

    custom_layout = {
        "id": "custom_showcase",
        "name": "Custom Showcase",
        "version": 1,
        "canvas": {
            "width": 720,
            "height": 1280,
            "background": {"kind": "color", "color": "#123456"},
        },
        "items": [
            {
                "id": "video",
                "kind": "video",
                "frame": {"x": 0.05, "y": 0.05, "width": 0.9, "height": 0.6},
            }
        ],
    }
    (root / "custom" / "custom_showcase.json").write_text(json.dumps(custom_layout), encoding="utf-8")

    monkeypatch.setenv("ATROPOS_LAYOUTS_ROOT", str(root))

    summaries = list_layouts()
    assert any(summary.category == "custom" and summary.id == "custom_showcase" for summary in summaries)
    assert any(summary.category == "builtin" for summary in summaries)


def test_out_root_sibling_directory_used(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    out_root = tmp_path / "pipeline" / "out"
    custom_dir = out_root.parent / "layouts" / "custom"
    custom_dir.mkdir(parents=True)
    payload = {
        "id": "sibling-layout",
        "name": "Sibling layout",
        "version": 1,
        "canvas": {"width": 480, "height": 852, "background": {"kind": "color", "color": "#abcdef"}},
        "items": [],
    }
    (custom_dir / "sibling.json").write_text(json.dumps(payload), encoding="utf-8")

    monkeypatch.delenv("ATROPOS_LAYOUTS_ROOT", raising=False)
    monkeypatch.setenv("OUT_ROOT", str(out_root))

    layout = load_layout("sibling-layout")
    assert layout.id == "sibling-layout"
    assert layout.canvas.height == 852


def test_load_layout_prefers_identifier_over_filename(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    root = tmp_path / "layouts"
    custom_dir = root / "custom"
    custom_dir.mkdir(parents=True)
    payload = {
        "id": "alias-layout",
        "name": "Alias layout",
        "version": 1,
        "canvas": {
            "width": 640,
            "height": 640,
            "background": {"kind": "blur"},
        },
        "items": [],
    }
    (custom_dir / "alt-name.json").write_text(json.dumps(payload), encoding="utf-8")
    monkeypatch.setenv("ATROPOS_LAYOUTS_ROOT", str(root))

    layout = load_layout("alias-layout")
    assert layout.id == "alias-layout"
    assert layout.canvas.width == 640


def test_load_layout_from_path_validates_payload(tmp_path: Path) -> None:
    bad_layout_path = tmp_path / "invalid.json"
    bad_layout_path.write_text(
        json.dumps(
            {
                "id": "broken",
                "name": "Broken layout",
                "version": 1,
                "canvas": {"width": 1080, "height": 1920, "background": {"kind": "unknown"}},
                "items": [],
            }
        ),
        encoding="utf-8",
    )

    with pytest.raises(LayoutValidationError):
        load_layout_from_path(bad_layout_path, category="custom")


def test_load_layout_unknown_identifier_raises(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setenv("ATROPOS_LAYOUTS_ROOT", str(tmp_path))
    with pytest.raises(LayoutNotFoundError):
        load_layout("does-not-exist")
