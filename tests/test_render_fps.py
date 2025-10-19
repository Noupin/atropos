from pathlib import Path
import sys

import pytest
import numpy as np

try:  # pragma: no cover - dependency guard
    import cv2
except ImportError:  # pragma: no cover - dependency guard
    cv2 = None

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "server"))

from server.layouts import LayoutIdentifier, get_default_registry
from server.steps.render import render_vertical_with_captions


pytestmark = pytest.mark.skipif(cv2 is None, reason="OpenCV is not available in the test environment")

REGISTRY = get_default_registry()
DEFAULT_LAYOUT = REGISTRY.load(LayoutIdentifier.parse("built_in:centered"))
DEFAULT_RESOLUTION = DEFAULT_LAYOUT.resolution_for("1080x1920")


def test_render_preserves_fps(tmp_path: Path) -> None:
    src_path = tmp_path / "src.mp4"
    fps = 17.0
    size = (64, 64)
    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    writer = cv2.VideoWriter(str(src_path), fourcc, fps, size)
    for _ in range(5):
        frame = np.random.randint(0, 256, (size[1], size[0], 3), dtype=np.uint8)
        writer.write(frame)
    writer.release()

    out_path = tmp_path / "out.mp4"
    render_vertical_with_captions(
        src_path,
        output_path=out_path,
        layout_spec=DEFAULT_LAYOUT,
        resolution=DEFAULT_RESOLUTION,
        mux_audio=False,
        use_cuda=False,
        use_opencl=False,
    )

    cap = cv2.VideoCapture(str(out_path))
    out_fps = cap.get(cv2.CAP_PROP_FPS)
    cap.release()

    assert abs(out_fps - fps) < 0.1


def test_render_without_caption_colors(tmp_path: Path) -> None:
    src_path = tmp_path / "src.mp4"
    fps = 10.0
    size = (64, 64)
    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    writer = cv2.VideoWriter(str(src_path), fourcc, fps, size)
    black = np.zeros((size[1], size[0], 3), dtype=np.uint8)
    for _ in range(3):
        writer.write(black)
    writer.release()

    out_path = tmp_path / "out.mp4"
    render_vertical_with_captions(
        src_path,
        captions=[(0.0, 1.0, "test")],
        output_path=out_path,
        layout_spec=DEFAULT_LAYOUT,
        resolution=DEFAULT_RESOLUTION,
        mux_audio=False,
        use_cuda=False,
        use_opencl=False,
        use_caption_colors=False,
    )

    assert out_path.exists()
