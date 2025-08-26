from __future__ import annotations

from pathlib import Path
from typing import List, Tuple, Optional, Union

import cv2
import numpy as np
import re
import json
import subprocess
import os


def render_vertical_with_captions(
    clip_path: str | Path,
    captions: Optional[Union[List[Tuple[float, float, str]], List[dict], str, Path]] = None,
    output_path: str | Path = None,
    *,
    frame_width: int = 1080,
    frame_height: int = 1920,
    fg_height_ratio: float = 0.42,      # slightly less zoom on FG
    fg_vertical_bias: float = 0.04,
    bottom_safe_ratio: float = 0.14,
    gap_below_fg: int = 28,
    font_scale: float = 1.0,
    thickness: int = 2,
    outline: int = 4,
    line_spacing: int = 10,
    wrap_width_px_ratio: float = 0.86,  # caption max width as ratio of frame_width
    blur_ksize: int = 31,               # must be odd; background blur amount
    fill_bgr: Tuple[int, int, int] = (255, 187, 28),   # hex 1cbbff -> RGB(28,187,255) -> BGR(255,187,28)
    outline_bgr: Tuple[int, int, int] = (236, 236, 236),  # hex ececec
) -> Path:
    """Render a vertical video with burned-in captions without using ffmpeg.

    The original clip is resized and placed with blurred background and captions.
    """
    clip_path = Path(clip_path)
    output = Path(output_path) if output_path is not None else Path(clip_path).with_name(Path(clip_path).stem + "_vertical.mp4")
    output.parent.mkdir(parents=True, exist_ok=True)

    temp_video = output.with_suffix('.video.mp4')

    _SRT_TIME = re.compile(r"^(\d{2}):(\d{2}):(\d{2}),(\d{3})\s+-->\s+(\d{2}):(\d{2}):(\d{2}),(\d{3})$")

    def _hmsms_to_sec(h: str, m: str, s: str, ms: str) -> float:
        return int(h) * 3600 + int(m) * 60 + int(s) + int(ms) / 1000.0

    def _parse_srt_text(s: str) -> List[Tuple[float, float, str]]:
        chunks = re.split(r"\r?\n\r?\n+", s.strip())
        out: List[Tuple[float, float, str]] = []
        for ch in chunks:
            lines = [ln for ln in ch.splitlines() if ln.strip() != ""]
            if not lines:
                continue
            # allow optional numeric index on first line
            idx = 0
            if lines and lines[0].strip().isdigit():
                idx = 1
            if idx >= len(lines):
                continue
            m = _SRT_TIME.match(lines[idx].strip())
            if not m:
                # not a timed block
                continue
            sh, sm, ss, sms, eh, em, es, ems = m.groups()
            start = _hmsms_to_sec(sh, sm, ss, sms)
            end = _hmsms_to_sec(eh, em, es, ems)
            text = " ".join(ln.strip() for ln in lines[idx+1:]).strip()
            if end > start and text:
                out.append((start, end, text))
        return out

    def _load_captions_from_path(p: Path) -> List[Tuple[float, float, str]]:
        if not p.exists():
            return []
        suf = p.suffix.lower()
        try:
            data = p.read_text(encoding="utf-8")
        except Exception:
            data = p.read_text(errors="ignore")
        if suf == ".srt":
            return _parse_srt_text(data)
        if suf == ".json":
            try:
                obj = json.loads(data)
                # expect list of dicts or tuples
                if isinstance(obj, list):
                    tmp: List[Tuple[float, float, str]] = []
                    for it in obj:
                        if isinstance(it, dict):
                            s = float(it.get("start", 0.0))
                            e = float(it.get("end", it.get("stop", s)))
                            txt = str(it.get("text", it.get("content", "")))
                            if e > s and txt:
                                tmp.append((s, e, txt))
                        elif isinstance(it, (list, tuple)) and len(it) >= 3:
                            s, e, txt = it[0], it[1], str(it[2])
                            if float(e) > float(s) and txt:
                                tmp.append((float(s), float(e), txt))
                    return tmp
            except Exception:
                return []
        # unknown extension
        return []

    def _normalize_caps(caps: Optional[Union[List[Tuple[float, float, str]], List[dict], str, Path]]) -> List[Tuple[float, float, str]]:
        if caps is None:
            return []
        # If a path or string was passed (legacy call sites), load from file
        if isinstance(caps, (str, Path)):
            return _load_captions_from_path(Path(caps))
        norm: List[Tuple[float, float, str]] = []
        for it in caps:
            if isinstance(it, dict):
                s = float(it.get("start", 0.0))
                e = float(it.get("end", it.get("stop", s)))
                txt = str(it.get("text", it.get("content", "")))
            else:
                s, e, txt = it  # type: ignore[misc]
            if e > s and txt:
                norm.append((s, e, txt))
        norm.sort(key=lambda x: x[0])
        return norm

    captions_norm = _normalize_caps(captions)

    if isinstance(captions, (str, Path)) and not captions_norm:
        print(f"WARN: No captions parsed from {captions}. Proceeding without text.")

    def _current_caption_text(t: float) -> str:
        # Binary search could be added; linear is fine for modest lists
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

        # --- Build blurred background (cover 9:16) ---
        h, w = frame.shape[:2]
        scale_bg = max(frame_width / w, frame_height / h)
        bg = cv2.resize(frame, (int(w * scale_bg), int(h * scale_bg)))
        # center-crop to exact frame
        y0 = max(0, (bg.shape[0] - frame_height) // 2)
        x0 = max(0, (bg.shape[1] - frame_width) // 2)
        bg = bg[y0:y0 + frame_height, x0:x0 + frame_width]
        # gaussian blur (ksize must be odd)
        k = blur_ksize if blur_ksize % 2 == 1 else blur_ksize + 1
        bg = cv2.GaussianBlur(bg, (k, k), 0)
        # slight dim for readability
        bg = cv2.addWeighted(bg, 0.55, np.zeros_like(bg), 0.45, 0)

        # --- Foreground scaled to a portion of the height and biased upward ---
        fg_target_h = max(100, int(frame_height * fg_height_ratio))
        scale_fg = fg_target_h / h
        fg_w, fg_h = int(w * scale_fg), int(h * scale_fg)
        fg = cv2.resize(frame, (fg_w, fg_h))
        # position
        x_fg = (frame_width - fg_w) // 2
        center_y = int(frame_height * (0.5 - fg_vertical_bias))
        y_fg = max(0, center_y - fg_h // 2)

        canvas = bg.copy()
        # --- Safe paste of FG into canvas with clipping ---
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

        # --- Captions under FG, wrapped, centered, with outline ---
        if current_text:
            max_text_w = int(frame_width * wrap_width_px_ratio)
            # simple greedy wrap by measuring getTextSize
            words = current_text.replace("\n", " ").split()
            lines: List[str] = []
            cur = ""
            for wtok in words:
                test = (cur + " " + wtok).strip()
                (tw, th), base = cv2.getTextSize(test, font, font_scale, thickness + outline)
                if tw <= max_text_w or not cur:
                    cur = test
                else:
                    lines.append(cur)
                    cur = wtok
            if cur:
                lines.append(cur)

            # place starting just below fg bottom, but above bottom safe area
            bottom_safe = int(frame_height * bottom_safe_ratio)
            # measure block height
            sizes = [cv2.getTextSize(ln, font, font_scale, thickness + outline)[0] for ln in lines]
            total_h = sum(sz[1] for sz in sizes) + line_spacing * max(0, len(lines) - 1)
            under_fg_y = y_fg + fg_h + gap_below_fg
            max_y = frame_height - bottom_safe - total_h
            y_text = max(0, min(under_fg_y, max_y))

            # draw each line centered with outline
            for ln in lines:
                (tw, th), base = cv2.getTextSize(ln, font, font_scale, thickness + outline)
                x_text = (frame_width - tw) // 2
                # outline
                for dx in (-outline, 0, outline):
                    for dy in (-outline, 0, outline):
                        if dx == 0 and dy == 0:
                            continue
                        cv2.putText(canvas, ln, (x_text + dx, y_text + th + dy), font, font_scale, outline_bgr, thickness + outline, line_type)
                # fill
                cv2.putText(canvas, ln, (x_text, y_text + th), font, font_scale, fill_bgr, thickness, line_type)
                y_text += th + line_spacing

        writer.write(canvas)

    cap.release()
    writer.release()

    # --- Mux original audio from source clip into the rendered video ---
    # If the source has no audio, the optional map (1:a:0?) prevents failure.
    mux_cmd = [
        "ffmpeg", "-y",
        "-i", str(temp_video),
        "-i", str(clip_path),
        "-map", "0:v:0", "-map", "1:a:0?",
        "-c:v", "copy", "-c:a", "copy",
        "-shortest",
        str(output),
    ]
    try:
        res = subprocess.run(mux_cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True)
    except subprocess.CalledProcessError as e:
        # Fall back: just move the video-only file to the final path if mux fails
        try:
            if temp_video.exists():
                temp_video.replace(output)
        except Exception:
            pass
        print("WARN: Audio mux failed; wrote video-only. STDERR head:\n" + (e.stderr.decode(errors='ignore')[:800] if e.stderr else ""))
    else:
        # Cleanup temp video after successful mux
        try:
            if temp_video.exists():
                os.remove(temp_video)
        except OSError:
            pass

    return output
