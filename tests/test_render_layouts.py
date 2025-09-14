from pathlib import Path
import sys
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "server"))

from server.steps.render_layouts import (
    CenteredZoomLayout,
    CenteredWithCornersLayout,
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


def test_corners_overlay() -> None:
    layout = CenteredWithCornersLayout()
    frame = np.zeros((100, 200, 3), dtype=np.uint8)
    bl_color = (255, 0, 0)
    br_color = (0, 255, 0)
    crop_w = int(200 * layout.crop_ratio)
    crop_h = int(100 * layout.crop_ratio)
    frame[-crop_h:, :crop_w] = bl_color
    frame[-crop_h:, -crop_w:] = br_color
    canvas = np.zeros((200, 100, 3), dtype=np.uint8)
    fg_top = 100
    out = layout.augment_canvas(canvas, frame, (0, fg_top, 0, 0))
    margin = int(100 * layout.margin_ratio)
    target_w = int(100 * layout.target_width_ratio)
    scale = target_w / crop_w
    target_h = int(crop_h * scale)
    expected_y_center = fg_top / 2
    expected_y = int(expected_y_center - target_h / 2)
    expected_y = max(margin, min(expected_y, fg_top - target_h - margin))
    left_px = out[expected_y + target_h // 2, margin + target_w // 2]
    right_px = out[
        expected_y + target_h // 2,
        100 - target_w - margin + target_w // 2,
    ]
    assert np.array_equal(left_px, bl_color)
    assert np.array_equal(right_px, br_color)
