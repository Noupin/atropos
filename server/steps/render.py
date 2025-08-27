from __future__ import annotations

from pathlib import Path
from typing import List, Tuple, Optional, Union

import cv2
import numpy as np
import subprocess
import os

from .captions import _normalize_caps


def _prepare_background(frame: np.ndarray, frame_width: int, frame_height: int, blur_ksize: int) -> np.ndarray:
    h, w = frame.shape[:2]
    scale_bg = max(frame_width / w, frame_height / h)
    bg = cv2.resize(frame, (int(w * scale_bg), int(h * scale_bg)))
    y0 = max(0, (bg.shape[0] - frame_height) // 2)
    x0 = max(0, (bg.shape[1] - frame_width) // 2)
    bg = bg[y0:y0 + frame_height, x0:x0 + frame_width]
    k = blur_ksize if blur_ksize % 2 == 1 else blur_ksize + 1
    bg = cv2.GaussianBlur(bg, (k, k), 0)
    bg = cv2.addWeighted(bg, 0.55, np.zeros_like(bg), 0.45, 0)
    return bg


def _place_foreground(
    bg: np.ndarray,
    frame: np.ndarray,
    frame_width: int,
    frame_height: int,
    fg_height_ratio: float,
    fg_vertical_bias: float,
) -> Tuple[np.ndarray, int, int]:
    h, w = frame.shape[:2]
    fg_target_h = max(100, int(frame_height * fg_height_ratio))
    scale_fg = fg_target_h / h
    fg_w, fg_h = int(w * scale_fg), int(h * scale_fg)
    fg = cv2.resize(frame, (fg_w, fg_h))
    x_fg = (frame_width - fg_w) // 2
    center_y = int(frame_height * (0.5 - fg_vertical_bias))
    y_fg = max(0, center_y - fg_h // 2)

    canvas = bg.copy()
    x1 = max(0, x_fg)
    y1 = max(0, y_fg)
    x2 = min(frame_width, x_fg + fg_w)
    y2 = min(frame_height, y_fg + fg_h)
    if x2 > x1 and y2 > y1:
        src_x1 = max(0, -x_fg)
        src_y1 = max(0, -y_fg)
        src_x2 = src_x1 + (x2 - x1)
        src_y2 = src_y1 + (y2 - y1)
        canvas[y1:y2, x1:x2] = fg[src_y1:src_y2, src_x1:src_x2]

    return canvas, y_fg, fg_h


def _draw_captions(
    canvas: np.ndarray,
    text: str,
    frame_width: int,
    frame_height: int,
    y_fg: int,
    fg_h: int,
    *,
    gap_below_fg: int,
    bottom_safe_ratio: float,
    line_spacing: int,
    wrap_width_px_ratio: float,
    font,
    line_type,
    font_scale: float,
    thickness: int,
    outline: int,
    fill_bgr: Tuple[int, int, int],
    outline_bgr: Tuple[int, int, int],
) -> np.ndarray:
    if not text:
        return canvas
    max_text_w = int(frame_width * wrap_width_px_ratio)
    words = text.replace("\n", " ").split()
    lines: List[str] = []
    cur = ""
    for wtok in words:
        test = (cur + " " + wtok).strip()
        (tw, _), _ = cv2.getTextSize(test, font, font_scale, thickness + outline)
        if tw <= max_text_w or not cur:
            cur = test
        else:
            lines.append(cur)
            cur = wtok
    if cur:
        lines.append(cur)

    bottom_safe = int(frame_height * bottom_safe_ratio)
    sizes = [cv2.getTextSize(ln, font, font_scale, thickness + outline)[0] for ln in lines]
    total_h = sum(sz[1] for sz in sizes) + line_spacing * max(0, len(lines) - 1)
    under_fg_y = y_fg + fg_h + gap_below_fg
    max_y = frame_height - bottom_safe - total_h
    y_text = max(0, min(under_fg_y, max_y))

    for ln in lines:
        (tw, th), _ = cv2.getTextSize(ln, font, font_scale, thickness + outline)
        x_text = (frame_width - tw) // 2
        for dx in (-outline, 0, outline):
            for dy in (-outline, 0, outline):
                if dx == 0 and dy == 0:
                    continue
                cv2.putText(
                    canvas,
                    ln,
                    (x_text + dx, y_text + th + dy),
                    font,
                    font_scale,
                    outline_bgr,
                    thickness + outline,
                    line_type,
                )
        cv2.putText(
            canvas,
            ln,
            (x_text, y_text + th),
            font,
            font_scale,
            fill_bgr,
            thickness,
            line_type,
        )
        y_text += th + line_spacing
    return canvas


def render_vertical_with_captions(
    clip_path: str | Path,
    captions: Optional[Union[List[Tuple[float, float, str]], List[dict], str, Path]] = None,
    output_path: str | Path = None,
    *,
    frame_width: int = 1080,
    frame_height: int = 1920,
    fg_height_ratio: float = 0.42,
    fg_vertical_bias: float = 0.04,
    bottom_safe_ratio: float = 0.14,
    gap_below_fg: int = 28,
    font_scale: float = 1.0,
    thickness: int = 2,
    outline: int = 4,
    line_spacing: int = 10,
    wrap_width_px_ratio: float = 0.86,
    blur_ksize: int = 31,
    fill_bgr: Tuple[int, int, int] = (255, 187, 28),
    outline_bgr: Tuple[int, int, int] = (236, 236, 236),
) -> Path:
    """Render a vertical video with burned-in captions without using ffmpeg."""

    clip_path = Path(clip_path)
    output = (
        Path(output_path)
        if output_path is not None
        else Path(clip_path).with_name(Path(clip_path).stem + "_vertical.mp4")
    )
    output.parent.mkdir(parents=True, exist_ok=True)

    temp_video = output.with_suffix(".video.mp4")

    captions_norm = _normalize_caps(captions)

    if isinstance(captions, (str, Path)) and not captions_norm:
        print(f"WARN: No captions parsed from {captions}. Proceeding without text.")

    def _current_caption_text(t: float) -> str:
        for (s, e, txt) in captions_norm:
            if s <= t < e:
                return txt
        return ""

    cap = cv2.VideoCapture(str(clip_path))
    if not cap.isOpened():
        raise RuntimeError(f"Cannot open video: {clip_path}")

    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0

    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    writer = cv2.VideoWriter(
        str(temp_video), fourcc, fps, (frame_width, frame_height)
    )
    if not writer.isOpened():
        cap.release()
        raise RuntimeError(f"Cannot create writer for: {output}")

    line_type = cv2.LINE_AA
    font = cv2.FONT_HERSHEY_SIMPLEX

    while True:
        ret, frame = cap.read()
        if not ret:
            break
        t = cap.get(cv2.CAP_PROP_POS_MSEC) / 1000.0
        current_text = _current_caption_text(t)

        bg = _prepare_background(frame, frame_width, frame_height, blur_ksize)
        canvas, y_fg, fg_h = _place_foreground(
            bg, frame, frame_width, frame_height, fg_height_ratio, fg_vertical_bias
        )
        canvas = _draw_captions(
            canvas,
            current_text,
            frame_width,
            frame_height,
            y_fg,
            fg_h,
            gap_below_fg=gap_below_fg,
            bottom_safe_ratio=bottom_safe_ratio,
            line_spacing=line_spacing,
            wrap_width_px_ratio=wrap_width_px_ratio,
            font=font,
            line_type=line_type,
            font_scale=font_scale,
            thickness=thickness,
            outline=outline,
            fill_bgr=fill_bgr,
            outline_bgr=outline_bgr,
        )
        writer.write(canvas)

    cap.release()
    writer.release()

    mux_cmd = [
        "ffmpeg",
        "-y",
        "-i",
        str(temp_video),
        "-i",
        str(clip_path),
        "-map",
        "0:v:0",
        "-map",
        "1:a:0?",
        "-c:v",
        "copy",
        "-c:a",
        "copy",
        "-shortest",
        str(output),
    ]
    try:
        subprocess.run(mux_cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True)
    except subprocess.CalledProcessError as e:
        try:
            if temp_video.exists():
                temp_video.replace(output)
        except Exception:
            pass
        print(
            "WARN: Audio mux failed; wrote video-only. STDERR head:\n"
            + (e.stderr.decode(errors="ignore")[:800] if e.stderr else "")
        )
    else:
        try:
            if temp_video.exists():
                os.remove(temp_video)
        except OSError:
            pass

    return output
