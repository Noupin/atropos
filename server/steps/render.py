from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, List, Tuple, Optional, Union

import numpy as np
import re
import json
import subprocess
import os
import shutil

try:  # pragma: no cover - import guard for environments without libGL
    import cv2
except Exception as exc:  # pragma: no cover - import guard
    cv2 = None  # type: ignore[assignment]
    _CV2_IMPORT_ERROR: Exception | None = exc
else:
    _CV2_IMPORT_ERROR = None
    cv2.ocl.setUseOpenCL(True)
    cv2.setUseOptimized(True)
    try:  # pragma: no cover - best effort tuning
        import multiprocessing as mp

        cv2.setNumThreads(max(1, mp.cpu_count() - 1))
    except Exception:
        pass

# --- Diagnostics: show whether OpenCL/FFMPEG are available (once per import) ---
def _log_build_info_once() -> None:
    if cv2 is None:  # pragma: no cover - depends on optional dependency
        return
    try:
        info = cv2.getBuildInformation()
        lines = []
        for ln in info.splitlines():
            if any(k in ln for k in ("OpenCL", "CUDA", "FFMPEG")):
                lines.append(ln.strip())
        print("[render] OpenCV build:", *lines[:10], sep="\n  ")
    except Exception:
        pass


if cv2 is not None:  # pragma: no cover - depends on optional dependency
    try:
        print(f"[render] OpenCL available={cv2.ocl.haveOpenCL()} useOpenCL={cv2.ocl.useOpenCL()}")
        _log_build_info_once()
    except Exception:
        pass


def _require_cv2() -> None:
    if cv2 is None:
        message = (
            "OpenCV (cv2) is required for layout rendering. Install opencv-python-headless "
            "and system libGL support to enable rendering operations."
        )
        raise RuntimeError(message) from _CV2_IMPORT_ERROR

from config import (
    CAPTION_FONT_SCALE,
    CAPTION_MAX_LINES,
    CAPTION_FILL_BGR,
    CAPTION_OUTLINE_BGR,
    CAPTION_USE_COLORS,
    OUTPUT_FPS,
)
from layouts.schema import BackgroundMode, LayoutSpec, Resolution, VideoCutSpec, ScaleMode, OverlaySpec

def _open_writer(path, fps, size):
    w, h = size
    trials = [
        # Prefer MSMF (Windows native) first
        (cv2.CAP_MSMF, cv2.VideoWriter_fourcc(*"H264")),
        (cv2.CAP_MSMF, cv2.VideoWriter_fourcc(*"avc1")),
        (cv2.CAP_MSMF, cv2.VideoWriter_fourcc(*"mp4v")),
        # Then FFMPEG, but avoid openh264 by using mp4v first
        (cv2.CAP_FFMPEG, cv2.VideoWriter_fourcc(*"mp4v")),
        (cv2.CAP_FFMPEG, cv2.VideoWriter_fourcc(*"avc1")),
        # Absolute last resort: MJPG in .avi (huge files, but unblocks you)
        (cv2.CAP_ANY,   cv2.VideoWriter_fourcc(*"MJPG")),
    ]
    for api, fourcc in trials:
        try:
            vw = cv2.VideoWriter(str(path), api, fourcc, fps, (w, h))
            if vw.isOpened():
                print(f"[render] VideoWriter OK → api={api} fourcc={fourcc}")
                return vw
        except Exception:
            pass
    return None



def render_vertical_with_captions(
    clip_path: str | Path,
    captions: Optional[Union[List[Tuple[float, float, str]], List[dict], str, Path]] = None,
    output_path: str | Path = None,
    *,
    layout_spec: LayoutSpec,
    resolution: Resolution,
    overlay_context: Dict[str, Any] | None = None,
    font_scale: float = CAPTION_FONT_SCALE,
    thickness: int = 2,
    outline: int = 4,
    line_spacing: int = 10,
    max_lines: int = CAPTION_MAX_LINES,
    wrap_width_px_ratio: float = 0.86,
    blur_ksize: int = 31,
    use_caption_colors: bool = CAPTION_USE_COLORS,
    fill_bgr: Tuple[int, int, int] = CAPTION_FILL_BGR,
    outline_bgr: Tuple[int, int, int] = CAPTION_OUTLINE_BGR,
    use_cuda: bool = True,
    use_opencl: bool = True,
    cache_text_layout: bool = True,
    mux_audio: bool = True,
) -> Path:
    """Render a vertical video with burned-in captions without using ffmpeg.

    The original clip is resized and placed with blurred background and captions.
    """
    _require_cv2()
    clip_path = Path(clip_path)
    output = (
        Path(output_path)
        if output_path is not None
        else Path(clip_path).with_name(Path(clip_path).stem + "_vertical.mp4")
    )
    output.parent.mkdir(parents=True, exist_ok=True)

    temp_video = output.with_suffix('.temp.mp4')

    fill_color = fill_bgr if use_caption_colors else (255, 255, 255)
    outline_color = outline_bgr if use_caption_colors else (0, 0, 0)

    frame_width = int(resolution.width)
    frame_height = int(resolution.height)

    margins = layout_spec.canvas.margins
    padding = layout_spec.canvas.padding
    content_origin_x = int(round(margins.left + padding.left))
    content_origin_y = int(round(margins.top + padding.top))
    content_width = max(
        1,
        int(
            round(
                frame_width
                - margins.left
                - margins.right
                - padding.left
                - padding.right
            )
        ),
    )
    content_height = max(
        1,
        int(
            round(
                frame_height
                - margins.top
                - margins.bottom
                - padding.top
                - padding.bottom
            )
        ),
    )

    background_mode = layout_spec.canvas.background.mode
    background_blur = layout_spec.canvas.background.blur_radius or blur_ksize
    if background_blur % 2 == 0:
        background_blur += 1
    background_opacity = float(layout_spec.canvas.background.opacity)

    static_background: np.ndarray | None = None
    if background_mode == BackgroundMode.SOLID_COLOR:
        color = layout_spec.canvas.background.color or (0, 0, 0)
        static_background = np.full(
            (frame_height, frame_width, 3),
            tuple(int(c) for c in color),
            dtype=np.uint8,
        )
    elif background_mode == BackgroundMode.TRANSPARENT:
        static_background = np.zeros((frame_height, frame_width, 3), dtype=np.uint8)

    overlay_context = overlay_context or {}

    def _resolve_target_rect(rect) -> Tuple[int, int, int, int]:
        tx = content_origin_x + int(round(rect.x * content_width))
        ty = content_origin_y + int(round(rect.y * content_height))
        tw = max(1, int(round(rect.width * content_width)))
        th = max(1, int(round(rect.height * content_height)))
        return tx, ty, tw, th

    def _resolve_source_rect(rect, frame_w: int, frame_h: int) -> Tuple[int, int, int, int]:
        sx = max(0, int(round(rect.x * frame_w)))
        sy = max(0, int(round(rect.y * frame_h)))
        sw = max(1, int(round(rect.width * frame_w)))
        sh = max(1, int(round(rect.height * frame_h)))
        if sx + sw > frame_w:
            sw = frame_w - sx
        if sy + sh > frame_h:
            sh = frame_h - sy
        return sx, sy, sw, sh

    def _rounded_rect_mask(width: int, height: int, radius: float) -> np.ndarray:
        mask = np.zeros((height, width), dtype=np.uint8)
        if radius <= 0:
            mask.fill(255)
            return mask
        r = int(round(min(radius, width / 2, height / 2)))
        if r <= 0:
            mask.fill(255)
            return mask
        cv2.rectangle(mask, (r, 0), (width - r, height), 255, -1)
        cv2.rectangle(mask, (0, r), (width, height - r), 255, -1)
        cv2.circle(mask, (r, r), r, 255, -1)
        cv2.circle(mask, (width - r - 1, r), r, 255, -1)
        cv2.circle(mask, (r, height - r - 1), r, 255, -1)
        cv2.circle(mask, (width - r - 1, height - r - 1), r, 255, -1)
        return mask

    def _render_cut_image(
        crop: np.ndarray, target_size: Tuple[int, int], scale_mode: ScaleMode
    ) -> np.ndarray:
        target_w, target_h = target_size
        if target_w <= 0 or target_h <= 0:
            return np.zeros((0, 0, 3), dtype=crop.dtype)
        if scale_mode == ScaleMode.STRETCH:
            return cv2.resize(crop, (target_w, target_h))

        src_h, src_w = crop.shape[:2]
        if src_h <= 0 or src_w <= 0:
            return np.zeros((target_h, target_w, 3), dtype=crop.dtype)

        scale_x = target_w / src_w
        scale_y = target_h / src_h

        if scale_mode == ScaleMode.CONTAIN:
            scale = min(scale_x, scale_y)
            scaled = cv2.resize(
                crop,
                (
                    max(1, int(round(src_w * scale))),
                    max(1, int(round(src_h * scale))),
                ),
            )
            result = np.zeros((target_h, target_w, 3), dtype=crop.dtype)
            y_offset = max(0, (target_h - scaled.shape[0]) // 2)
            x_offset = max(0, (target_w - scaled.shape[1]) // 2)
            result[
                y_offset : y_offset + scaled.shape[0],
                x_offset : x_offset + scaled.shape[1],
            ] = scaled
            return result

        scale = max(scale_x, scale_y)
        scaled = cv2.resize(
            crop,
            (
                max(1, int(round(src_w * scale))),
                max(1, int(round(src_h * scale))),
            ),
        )
        y_offset = max(0, (scaled.shape[0] - target_h) // 2)
        x_offset = max(0, (scaled.shape[1] - target_w) // 2)
        return scaled[
            y_offset : y_offset + target_h,
            x_offset : x_offset + target_w,
        ]

    def _blit_cut(
        canvas: np.ndarray,
        image: np.ndarray,
        target: Tuple[int, int, int, int],
        radius: float,
    ) -> None:
        tx, ty, tw, th = target
        if tw <= 0 or th <= 0:
            return
        if image.shape[0] != th or image.shape[1] != tw:
            image = cv2.resize(image, (tw, th))
        mask = _rounded_rect_mask(tw, th, radius)
        roi = canvas[ty : ty + th, tx : tx + tw]
        if roi.shape[:2] != image.shape[:2]:
            return
        np.copyto(roi, image, where=mask[..., None] > 0)

    def _lookup(path: str) -> Any:
        cursor: Any = overlay_context
        for segment in path.split('.'):
            if isinstance(cursor, dict) and segment in cursor:
                cursor = cursor[segment]
            else:
                return None
        return cursor

    _template_pattern = re.compile(r"\{\{\s*([^}]+?)\s*\}\}")

    def _render_template(template: str) -> str:
        def _replace(match: re.Match) -> str:
            key = match.group(1).strip()
            value = _lookup(key)
            return "" if value is None else str(value)

        return _template_pattern.sub(_replace, template)

    def _font_scale_for_height(target_height: float, base_thickness: int) -> float:
        low, high = 0.1, 10.0
        for _ in range(12):
            mid = (low + high) / 2.0
            size = cv2.getTextSize("Hg", cv2.FONT_HERSHEY_SIMPLEX, mid, base_thickness)[0][1]
            if size < target_height:
                low = mid
            else:
                high = mid
        return low

    def _wrap_text(
        text: str,
        font_scale_value: float,
        max_width_px: int,
        base_thickness: int,
    ) -> List[str]:
        text = text.replace("\r", "")
        tokens = []
        for part in text.split("\n"):
            if tokens:
                tokens.append("\n")
            tokens.extend(part.split())
        lines: List[str] = []
        current = ""
        for token in tokens:
            if token == "\n":
                if current:
                    lines.append(current.strip())
                    current = ""
                else:
                    lines.append("")
                continue
            candidate = (current + " " + token).strip()
            width = cv2.getTextSize(candidate, cv2.FONT_HERSHEY_SIMPLEX, font_scale_value, base_thickness)[0][0]
            if width <= max_width_px or not current:
                current = candidate
            else:
                if current:
                    lines.append(current)
                current = token
        if current:
            lines.append(current)
        return lines if lines else [""]

    def _draw_overlay(
        canvas: np.ndarray,
        overlay: OverlaySpec,
        target: Tuple[int, int, int, int],
    ) -> None:
        if overlay.type != "text":
            return
        rendered = _render_template(overlay.text.text)
        if not rendered.strip():
            return
        tx, ty, tw, th = target
        desired_height = max(8.0, overlay.text.font_size)
        base_thickness = 2
        font_scale_value = _font_scale_for_height(desired_height, base_thickness)
        lines = _wrap_text(rendered, font_scale_value, max(1, tw), base_thickness)
        metrics = [
            cv2.getTextSize(line, cv2.FONT_HERSHEY_SIMPLEX, font_scale_value, base_thickness)[0]
            for line in lines
        ]
        if metrics:
            base_height = metrics[0][1]
        else:
            base_height = int(desired_height)
        total_height = 0
        for width, height in metrics:
            total_height += height
            total_height += int(max(0.0, overlay.text.line_height - 1.0) * height)
        if total_height > th and total_height > 0:
            scale_factor = th / total_height
            font_scale_value *= scale_factor
            lines = _wrap_text(rendered, font_scale_value, max(1, tw), base_thickness)
            metrics = [
                cv2.getTextSize(line, cv2.FONT_HERSHEY_SIMPLEX, font_scale_value, base_thickness)[0]
                for line in lines
            ]
            total_height = 0
            for width, height in metrics:
                total_height += height
                total_height += int(max(0.0, overlay.text.line_height - 1.0) * height)
        if total_height <= 0:
            return
        cursor_y = ty + max(0, (th - total_height) // 2)
        for (line, (width, height)) in zip(lines, metrics):
            if overlay.text.alignment.value == "left":
                cursor_x = tx
            elif overlay.text.alignment.value == "right":
                cursor_x = tx + max(0, tw - width)
            else:
                cursor_x = tx + max(0, (tw - width) // 2)
            if overlay.text.shadow:
                cv2.putText(
                    canvas,
                    line,
                    (cursor_x + 2, cursor_y + height + 2),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    font_scale_value,
                    (0, 0, 0),
                    base_thickness + 2,
                    cv2.LINE_AA,
                )
            cv2.putText(
                canvas,
                line,
                (cursor_x, cursor_y + height),
                cv2.FONT_HERSHEY_SIMPLEX,
                font_scale_value,
                tuple(int(c) for c in overlay.text.color),
                base_thickness,
                cv2.LINE_AA,
            )
            advance = height + int(max(0.0, overlay.text.line_height - 1.0) * height)
            cursor_y += advance

    # --- HW accel probes ---
    if use_opencl:
        try:
            cv2.ocl.setUseOpenCL(True)
        except Exception:
            pass

    if use_cuda:
        try:
            use_cuda = cv2.cuda.getCudaEnabledDeviceCount() > 0
        except Exception:
            use_cuda = False

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
            if (s - time_tolerance) <= t <= (e + time_tolerance):
                return txt
        return ""

    cap = cv2.VideoCapture(str(clip_path), cv2.CAP_FFMPEG)
    if not cap.isOpened():
        raise RuntimeError(f"Cannot open video: {clip_path}")

    # Match source FPS to avoid playback speed changes; fall back to default
    fps = cap.get(cv2.CAP_PROP_FPS)
    if not fps or np.isnan(fps) or fps <= 0:
        fps = OUTPUT_FPS

    frame_duration = 1.0 / fps
    time_tolerance = max(frame_duration / 2.0, 1e-3)

    # Prefer H.264 writer; fall back to mp4v if unavailable
    writer = _open_writer(temp_video, fps, (frame_width, frame_height))
    if writer is None:
        cap.release()
        raise RuntimeError("Cannot create VideoWriter (failed all backends/fourcc).")

    line_type = cv2.LINE_AA
    font = cv2.FONT_HERSHEY_SIMPLEX

    # --- Caption layout cache (recompute only when text changes) ---
    _last_text = None
    _last_scale = None
    _last_spacing = None
    _cached_lines: List[str] = []
    _cached_sizes: List[Tuple[int, int]] = []
    _cached_total_h: int = 0

    def _measure_and_wrap(text: str, scale: float, spacing: int):
        nonlocal _last_text, _last_scale, _last_spacing, _cached_lines, _cached_sizes, _cached_total_h
        if (
            (not cache_text_layout)
            or (text != _last_text)
            or (scale != _last_scale)
            or (spacing != _last_spacing)
        ):
            max_text_w = caption_wrap_width
            words = text.replace("\n", " ").split()
            lines: List[str] = []
            cur = ""
            for wtok in words:
                test = (cur + " " + wtok).strip()
                (tw, _), _ = cv2.getTextSize(test, font, scale, thickness + outline)
                if tw <= max_text_w or not cur:
                    cur = test
                else:
                    lines.append(cur)
                    cur = wtok
            if cur:
                lines.append(cur)
            sizes = [cv2.getTextSize(ln, font, scale, thickness + outline)[0] for ln in lines]
            total_h = sum(sz[1] for sz in sizes) + spacing * max(0, len(lines) - 1)
            _last_text, _last_scale, _last_spacing = text, scale, spacing
            _cached_lines, _cached_sizes, _cached_total_h = lines, sizes, total_h
        return _cached_lines, _cached_sizes, _cached_total_h

    def _split_long_captions(
        caps: List[Tuple[float, float, str]],
        max_lines: int,
    ) -> List[Tuple[float, float, str]]:
        out: List[Tuple[float, float, str]] = []
        for s, e, txt in caps:
            lines, _, _ = _measure_and_wrap(txt, font_scale, line_spacing)
            if len(lines) <= max_lines:
                out.append((s, e, txt))
                continue
            total_lines = len(lines)
            duration = e - s
            idx = 0
            cur_start = s
            while idx < total_lines:
                seg_lines = lines[idx:idx + max_lines]
                seg_text = " ".join(seg_lines)
                seg_count = len(seg_lines)
                seg_duration = duration * (seg_count / total_lines)
                out.append((cur_start, cur_start + seg_duration, seg_text))
                cur_start += seg_duration
                idx += seg_count
        return out

    captions_norm = _split_long_captions(captions_norm, max_lines)
    _last_text = _last_scale = _last_spacing = None
    _cached_lines = []
    _cached_sizes = []
    _cached_total_h = 0

    frame_idx = 0
    runtime_cuts: List[Tuple[VideoCutSpec, Tuple[int, int, int, int], Tuple[int, int, int, int]]] = []
    overlay_targets: List[Tuple[OverlaySpec, Tuple[int, int, int, int]]] = [
        (overlay, _resolve_target_rect(overlay.text.target_rect))
        for overlay in layout_spec.sorted_overlays()
    ]

    caption_wrap_width = max(1, int(content_width * wrap_width_px_ratio))
    bottom_safe_px = int(round(margins.bottom + padding.bottom))
    top_safe_px = int(round(margins.top + padding.top))

    while True:
        ret, frame = cap.read()
        if not ret:
            break
        t = (frame_idx + 0.5) * frame_duration
        current_text = _current_caption_text(t)

        h, w = frame.shape[:2]

        if background_mode == BackgroundMode.VIDEO_BLUR:
            scale_bg = max(frame_width / w, frame_height / h)
            resized = cv2.resize(frame, (int(w * scale_bg), int(h * scale_bg)))
            y0 = max(0, (resized.shape[0] - frame_height) // 2)
            x0 = max(0, (resized.shape[1] - frame_width) // 2)
            cropped = resized[y0 : y0 + frame_height, x0 : x0 + frame_width]
            blurred = cv2.GaussianBlur(cropped, (background_blur, background_blur), 0)
            if background_opacity < 1.0:
                blurred = cv2.addWeighted(
                    blurred,
                    background_opacity,
                    np.zeros_like(blurred),
                    1.0 - background_opacity,
                    0,
                )
            canvas = blurred
        else:
            canvas = static_background.copy()

        if not runtime_cuts:
            runtime_cuts = [
                (
                    spec,
                    _resolve_target_rect(spec.target_rect),
                    _resolve_source_rect(spec.source_rect, w, h),
                )
                for spec in layout_spec.sorted_video_cuts()
            ]

        for spec, target_box, source_box in runtime_cuts:
            sx, sy, sw, sh = source_box
            tx, ty, tw, th = target_box
            crop = frame[sy : sy + sh, sx : sx + sw]
            cut_img = _render_cut_image(crop, (tw, th), spec.scale_mode)
            if cut_img.size == 0:
                continue
            _blit_cut(canvas, cut_img, target_box, spec.border_radius)

        for overlay, target in overlay_targets:
            _draw_overlay(canvas, overlay, target)

        # --- Captions under FG, wrapped, centered, with outline ---
        if current_text:
            fs = font_scale
            spacing = line_spacing
            lines, sizes, total_h = _measure_and_wrap(current_text, fs, spacing)
            available_h = frame_height - bottom_safe_px - top_safe_px
            if total_h > available_h and available_h > 0:
                fs = fs * (available_h / total_h)
                spacing = max(1, int(line_spacing * fs / font_scale))
                lines, sizes, total_h = _measure_and_wrap(current_text, fs, spacing)
            y_text = frame_height - bottom_safe_px - total_h
            y_text = max(top_safe_px, y_text)

            # draw each line centered with outline
            for ln in lines:
                (tw, th), _ = cv2.getTextSize(ln, font, fs, thickness + outline)
                x_text = max(content_origin_x, (frame_width - tw) // 2)
                # outline
                for dx in (-outline, 0, outline):
                    for dy in (-outline, 0, outline):
                        if dx == 0 and dy == 0:
                            continue
                        cv2.putText(
                            canvas,
                            ln,
                            (x_text + dx, y_text + th + dy),
                            font,
                            fs,
                            outline_color,
                            thickness + outline,
                            line_type,
                        )
                # fill
                cv2.putText(
                    canvas,
                    ln,
                    (x_text, y_text + th),
                    font,
                    fs,
                    fill_color,
                    thickness,
                    line_type,
                )
                y_text += th + spacing

        writer.write(canvas)
        frame_idx += 1

    cap.release()
    writer.release()

    # --- Optional: Mux original audio (disabled if ffmpeg not present or mux_audio=False) ---
    if mux_audio and shutil.which("ffmpeg") is not None:
        gop = max(1, int(round(fps)) * 2)
        mux_cmd = [
            "ffmpeg", "-y",
            "-i", str(temp_video),          # video (from OpenCV)
            "-i", str(clip_path),           # original (for audio track)
            "-map", "0:v:0", "-map", "1:a:0?",
            # Re-encode video to H.264 + yuv420p at source FPS, faststart
            "-c:v", "libx264",
            "-pix_fmt", "yuv420p",
            "-profile:v", "high", "-level", "4.1",
            "-r", f"{fps}",
            "-vsync", "cfr",
            "-g", str(gop),
            "-movflags", "+faststart",
            # Normalize audio to AAC if present
            "-c:a", "aac", "-b:a", "192k", "-ar", "44100",
            "-shortest",
            str(output),
        ]
        try:
            res = subprocess.run(mux_cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True)
            try:
                if temp_video.exists():
                    os.remove(temp_video)
            except OSError:
                pass
        except subprocess.CalledProcessError as e:
            # Fall back: just move the video-only file to the final path if mux fails
            try:
                if temp_video.exists():
                    temp_video.replace(output)
            except Exception:
                pass
            print("WARN: Audio mux/transcode failed; wrote video-only. STDERR head:\n" + (e.stderr.decode(errors='ignore')[:800] if e.stderr else ""))
    else:
        # No mux: write video-only as final
        if temp_video.exists():
            try:
                temp_video.replace(output)
            except Exception:
                pass

    return output
