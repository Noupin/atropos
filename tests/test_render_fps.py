import cv2
import numpy as np
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "server"))

from server.steps.render import render_vertical_with_captions


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
        frame_width=160,
        frame_height=280,
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
        frame_width=160,
        frame_height=280,
        mux_audio=False,
        use_cuda=False,
        use_opencl=False,
        use_caption_colors=False,
    )

    assert out_path.exists()
