from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "server"))

from server.steps.render_layouts import (
    CenteredZoomLayout,
    NoZoomLayout,
    LeftAlignedZoomLayout,
)


def test_no_zoom_scales_down() -> None:
    layout = NoZoomLayout()
    scale = layout.scale_factor(200, 100, 100, 200, 0.5)
    assert abs(scale - 0.5) < 1e-6


def test_left_aligned_position() -> None:
    layout = LeftAlignedZoomLayout()
    scale = layout.scale_factor(100, 100, 200, 400, 0.5)
    fg_width = int(100 * scale)
    assert layout.x_position(fg_width, 200) == 0


def test_centered_position() -> None:
    layout = CenteredZoomLayout()
    scale = layout.scale_factor(100, 100, 300, 400, 0.5)
    fg_width = int(100 * scale)
    assert layout.x_position(fg_width, 300) == 50
