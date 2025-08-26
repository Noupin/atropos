from __future__ import annotations

from pathlib import Path

import cv2
import numpy as np
import srt


def render_vertical_with_captions(
    clip_path: str | Path,
    srt_path: str | Path,
    output_path: str | Path,
    *,
    frame_width: int = 1080,
    frame_height: int = 1920,
) -> Path:
    """Render a vertical video with burned-in captions without using ffmpeg.

    The original clip is resized to ``frame_width`` and placed at the top of a
    ``frame_width`` x ``frame_height`` canvas. Captions from ``srt_path`` are
    rendered centered in the area beneath the video.
    """
    clip_path = Path(clip_path)
    srt_path = Path(srt_path)
    output = Path(output_path)
    output.parent.mkdir(parents=True, exist_ok=True)

    cap = cv2.VideoCapture(str(clip_path))
    if not cap.isOpened():
        raise RuntimeError(f"Cannot open video: {clip_path}")

    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0

    with srt_path.open("r", encoding="utf-8") as f:
        subs = list(srt.parse(f.read()))

    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    writer = cv2.VideoWriter(
        str(output), fourcc, fps, (frame_width, frame_height)
    )
    if not writer.isOpened():
        cap.release()
        raise RuntimeError(f"Cannot create writer for: {output}")

    idx = 0
    current_text = ""

    font = cv2.FONT_HERSHEY_SIMPLEX
    font_scale = 1.0
    thickness = 2
    line_type = cv2.LINE_AA

    while True:
        ret, frame = cap.read()
        if not ret:
            break

        t = cap.get(cv2.CAP_PROP_POS_MSEC) / 1000.0

        while idx < len(subs) and t >= subs[idx].end.total_seconds():
            idx += 1
        if idx < len(subs) and subs[idx].start.total_seconds() <= t < subs[idx].end.total_seconds():
            current_text = subs[idx].content
        else:
            current_text = ""

        h, w = frame.shape[:2]
        scale = frame_width / w
        resized = cv2.resize(frame, (frame_width, int(h * scale)))

        canvas = np.zeros((frame_height, frame_width, 3), dtype=np.uint8)
        canvas[: resized.shape[0], : resized.shape[1]] = resized

        if current_text:
            lines = current_text.splitlines()
            y = resized.shape[0] + 40
            for line in lines:
                size, base = cv2.getTextSize(line, font, font_scale, thickness)
                x = (frame_width - size[0]) // 2
                cv2.putText(
                    canvas,
                    line,
                    (x, y + size[1]),
                    font,
                    font_scale,
                    (255, 255, 255),
                    thickness,
                    line_type,
                )
                y += size[1] + base + 10

        writer.write(canvas)

    cap.release()
    writer.release()
    return output
