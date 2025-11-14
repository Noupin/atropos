from __future__ import annotations

from dataclasses import dataclass, replace
from pathlib import Path
from typing import List, Tuple, Optional, Union

import cv2
cv2.ocl.setUseOpenCL(True)
cv2.setUseOptimized(True)
try:
    # Optional: cap OpenCV threads to avoid CPU oversubscription
    import multiprocessing as mp
    cv2.setNumThreads(max(1, mp.cpu_count() - 1))
except Exception:
    pass
import numpy as np
import re
import json
import subprocess
import os
import shutil

# --- Diagnostics: show whether OpenCL/FFMPEG are available (once per import) ---
def _log_build_info_once():
    try:
        info = cv2.getBuildInformation()
        lines = []
        for ln in info.splitlines():
            if any(k in ln for k in ("OpenCL", "CUDA", "FFMPEG")):
                lines.append(ln.strip())
        print("[render] OpenCV build:", *lines[:10], sep="\n  ")
    except Exception:
        pass

try:
    print(f"[render] OpenCL available={cv2.ocl.haveOpenCL()} useOpenCL={cv2.ocl.useOpenCL()}")
    _log_build_info_once()
except Exception:
    pass

from config import (
    CAPTION_FONT_SCALE,
    CAPTION_MAX_LINES,
    CAPTION_FILL_BGR,
    CAPTION_HIGHLIGHT_BGR,
    CAPTION_OUTLINE_BGR,
    CAPTION_USE_COLORS,
    OUTPUT_FPS,
    VIDEO_ZOOM_RATIO,
    RENDER_LAYOUT,
)
from layouts import (
    LayoutCanvas,
    LayoutDefinition,
    LayoutNotFoundError,
    PixelRect,
    load_layout,
    prepare_layout,
)

@dataclass
class CaptionWord:
    start: float
    end: float
    text: str


@dataclass
class CaptionEntry:
    start: float
    end: float
    text: str
    words: List[CaptionWord]


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
    frame_width: int | None = None,
    frame_height: int | None = None,
    bottom_safe_ratio: float = 0.14,
    layout: LayoutDefinition | str | None = None,
    font_scale: float = CAPTION_FONT_SCALE,  # baseline; may shrink to keep captions below FG
    thickness: int = 2,
    outline: int = 4,
    line_spacing: int = 10,
    max_lines: int = CAPTION_MAX_LINES,
    wrap_width_px_ratio: float = 0.86,  # caption max width as ratio of frame_width
    blur_ksize: int = 31,               # must be odd; background blur amount
    use_caption_colors: bool = CAPTION_USE_COLORS,
    fill_bgr: Tuple[int, int, int] = CAPTION_FILL_BGR,
    outline_bgr: Tuple[int, int, int] = CAPTION_OUTLINE_BGR,
    # NEW performance toggles
    use_cuda: bool = True,
    use_opencl: bool = True,
    cache_text_layout: bool = True,
    # audio handling (no ffmpeg for *rendering*; mux is optional)
    mux_audio: bool = True,
) -> Path:
    """Render a vertical video with burned-in captions without using ffmpeg.

    The original clip is resized and placed with blurred background and captions.
    """
    clip_path = Path(clip_path)
    output = Path(output_path) if output_path is not None else Path(clip_path).with_name(Path(clip_path).stem + "_vertical.mp4")
    output.parent.mkdir(parents=True, exist_ok=True)

    temp_video = output.with_suffix('.temp.mp4')

    fill_color = fill_bgr if use_caption_colors else (255, 255, 255)
    highlight_color = CAPTION_HIGHLIGHT_BGR if use_caption_colors else fill_color
    base_caption_color = (255, 255, 255)
    outline_color = outline_bgr if use_caption_colors else (0, 0, 0)

    if layout is None:
        try:
            layout_definition = load_layout(RENDER_LAYOUT)
        except LayoutNotFoundError:
            layout_definition = load_layout("centered")
    elif isinstance(layout, str):
        try:
            layout_definition = load_layout(layout)
        except LayoutNotFoundError:
            layout_definition = load_layout(RENDER_LAYOUT)
    else:
        layout_definition = layout

    prepared_layout = prepare_layout(layout_definition)

    if frame_width is None:
        frame_width = prepared_layout.width
    if frame_height is None:
        frame_height = prepared_layout.height

    if frame_width != prepared_layout.width or frame_height != prepared_layout.height:
        adjusted = replace(
            layout_definition,
            canvas=LayoutCanvas(
                width=frame_width,
                height=frame_height,
                background=layout_definition.canvas.background,
            ),
        )
        prepared_layout = prepare_layout(adjusted)
        layout_definition = adjusted

    frame_width = int(frame_width)
    frame_height = int(frame_height)

    caption_rect = prepared_layout.caption_rect
    caption_align = prepared_layout.caption_align or "center"
    caption_max_lines = 1
    if prepared_layout.caption_wrap_width is not None:
        caption_wrap_pixels = int(prepared_layout.caption_wrap_width * frame_width)
    elif caption_rect is not None:
        caption_wrap_pixels = caption_rect.width
    else:
        caption_wrap_pixels = int(frame_width * wrap_width_px_ratio)

    background_spec = layout_definition.canvas.background
    background_image = None
    background_mode = background_spec.mode or "cover"
    if background_spec.kind == "image" and background_spec.source:
        image_path = Path(background_spec.source)
        if not image_path.is_absolute() and layout_definition.source_path:
            image_path = (layout_definition.source_path.parent / background_spec.source).resolve()
        if image_path.exists():
            background_image = cv2.imread(str(image_path))

    def _parse_color_hex(value: str | None, fallback: Tuple[int, int, int] = (0, 0, 0)) -> Tuple[int, int, int]:
        if not value:
            return fallback
        value = value.strip().lstrip('#')
        if len(value) == 3:
            value = ''.join(ch * 2 for ch in value)
        if len(value) != 6:
            return fallback
        try:
            r = int(value[0:2], 16)
            g = int(value[2:4], 16)
            b = int(value[4:6], 16)
        except ValueError:
            return fallback
        return (b, g, r)

    def _resize_background_image(image: np.ndarray) -> np.ndarray:
        src_h, src_w = image.shape[:2]
        if src_h <= 0 or src_w <= 0:
            return np.zeros((frame_height, frame_width, 3), dtype=np.uint8)
        scale_w = frame_width / src_w
        scale_h = frame_height / src_h
        if background_mode == "contain":
            scale = min(scale_w, scale_h)
            new_w = max(1, int(src_w * scale))
            new_h = max(1, int(src_h * scale))
            resized = cv2.resize(image, (new_w, new_h))
            canvas = np.zeros((frame_height, frame_width, 3), dtype=np.uint8)
            offset_x = max(0, (frame_width - new_w) // 2)
            offset_y = max(0, (frame_height - new_h) // 2)
            canvas[offset_y:offset_y + new_h, offset_x:offset_x + new_w] = resized
            return canvas
        scale = max(scale_w, scale_h)
        new_w = max(1, int(src_w * scale))
        new_h = max(1, int(src_h * scale))
        resized = cv2.resize(image, (new_w, new_h))
        x0 = max(0, (new_w - frame_width) // 2)
        y0 = max(0, (new_h - frame_height) // 2)
        return resized[y0:y0 + frame_height, x0:x0 + frame_width]

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

    # Prepare a reusable Gaussian filter on GPU if available
    gpu_gauss = None
    if use_cuda:
        try:
            k = blur_ksize if blur_ksize % 2 == 1 else blur_ksize + 1
            gpu_gauss = cv2.cuda.createGaussianFilter(cv2.CV_8UC3, cv2.CV_8UC3, (k, k), 0)
        except Exception:
            gpu_gauss = None
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

    def _load_caption_words(source: Optional[Union[List[dict], str, Path]]) -> List[CaptionWord]:
        if isinstance(source, (str, Path)):
            json_path = Path(source).with_suffix(".words.json")
            if json_path.exists():
                try:
                    data = json.loads(json_path.read_text(encoding="utf-8"))
                except (OSError, json.JSONDecodeError):
                    return []
                words: List[CaptionWord] = []
                for item in data.get("words", []) or []:
                    try:
                        start = float(item.get("start"))
                        end = float(item.get("end"))
                    except (TypeError, ValueError):
                        continue
                    text = str(item.get("text") or item.get("word") or "").strip()
                    if not text or end <= start:
                        continue
                    words.append(CaptionWord(start=start, end=end, text=text))
                words.sort(key=lambda w: w.start)
                return words
        return []

    def _normalize_caps(
        caps: Optional[Union[List[Tuple[float, float, str]], List[dict], str, Path]]
    ) -> List[CaptionEntry]:
        entries: List[CaptionEntry] = []
        if caps is None:
            return entries
        if isinstance(caps, (str, Path)):
            loaded = _load_captions_from_path(Path(caps))
        else:
            loaded = []
            for it in caps:
                if isinstance(it, dict):
                    s = float(it.get("start", 0.0))
                    e = float(it.get("end", it.get("stop", s)))
                    txt = str(it.get("text", it.get("content", "")))
                else:
                    s, e, txt = it  # type: ignore[misc]
                if e > s and txt:
                    loaded.append((float(s), float(e), txt))
        loaded.sort(key=lambda x: x[0])
        for s, e, txt in loaded:
            entries.append(CaptionEntry(start=float(s), end=float(e), text=str(txt), words=[]))
        return entries

    caption_entries = _normalize_caps(captions)
    caption_words = _load_caption_words(captions)

    if isinstance(captions, (str, Path)) and not caption_entries:
        print(f"WARN: No captions parsed from {captions}. Proceeding without text.")

    def _assign_words_to_entries(entries: List[CaptionEntry], words: List[CaptionWord]) -> None:
        if not words:
            return
        for entry in entries:
            entry.words = [
                CaptionWord(start=w.start, end=w.end, text=w.text)
                for w in words
                if not (w.end <= entry.start or w.start >= entry.end)
            ]

    _assign_words_to_entries(caption_entries, caption_words)

    def _ensure_entry_words(entry: CaptionEntry) -> List[CaptionWord]:
        if entry.words:
            return entry.words
        tokens = entry.text.replace("\n", " ").split()
        if not tokens:
            entry.words = []
            return entry.words
        duration = max(entry.end - entry.start, 0.01)
        step = max(duration / max(len(tokens), 1), 0.01)
        cur = entry.start
        fallback: List[CaptionWord] = []
        for idx, token in enumerate(tokens):
            token = token.strip()
            if not token:
                continue
            nxt = cur + step
            if idx == len(tokens) - 1:
                nxt = max(nxt, entry.end)
            fallback.append(CaptionWord(start=cur, end=nxt, text=token))
            cur = nxt
        if fallback and fallback[-1].end < entry.end:
            fallback[-1].end = entry.end
        entry.words = fallback
        return entry.words

    def _current_caption_entry(t: float) -> Optional[CaptionEntry]:
        for entry in caption_entries:
            if (entry.start - time_tolerance) <= t <= (entry.end + time_tolerance):
                return entry
        return None

    cap = cv2.VideoCapture(str(clip_path), cv2.CAP_FFMPEG)
    if not cap.isOpened():
        cap.release()
        cap = cv2.VideoCapture(str(clip_path), cv2.CAP_ANY)
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
            max_text_w = max(1, caption_wrap_pixels)
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
        caps: List[CaptionEntry],
        max_lines: int,
    ) -> List[CaptionEntry]:
        if max_lines <= 0:
            return caps
        out: List[CaptionEntry] = []
        for entry in caps:
            lines, _, _ = _measure_and_wrap(entry.text, font_scale, line_spacing)
            if len(lines) <= max_lines:
                out.append(entry)
                continue
            seq_words = list(_ensure_entry_words(entry))
            word_idx = 0
            total_lines = len(lines)
            for idx in range(0, total_lines, max_lines):
                seg_lines = lines[idx:idx + max_lines]
                if not seg_lines:
                    continue
                seg_word_count = sum(len(seg_line.split()) for seg_line in seg_lines)
                seg_words = seq_words[word_idx:word_idx + seg_word_count] if seg_word_count else []
                word_idx += seg_word_count
                seg_text = " ".join(seg_lines).strip()
                if not seg_text:
                    continue
                if seg_words:
                    seg_start = seg_words[0].start
                    seg_end = seg_words[-1].end
                else:
                    portion_start = idx / max(total_lines, 1)
                    portion_end = min(total_lines, idx + len(seg_lines)) / max(total_lines, 1)
                    span = entry.end - entry.start
                    seg_start = entry.start + span * portion_start
                    seg_end = entry.start + span * portion_end
                out.append(
                    CaptionEntry(
                        start=seg_start,
                        end=seg_end,
                        text=seg_text,
                        words=[CaptionWord(start=w.start, end=w.end, text=w.text) for w in seg_words],
                    )
                )
        out.sort(key=lambda e: e.start)
        return out

    caption_entries = _split_long_captions(caption_entries, caption_max_lines)
    _last_text = _last_scale = _last_spacing = None
    _cached_lines = []
    _cached_sizes = []
    _cached_total_h = 0

    frame_idx = 0
    while True:
        ret, frame = cap.read()
        if not ret:
            break
        t = (frame_idx + 0.5) * frame_duration
        current_entry = _current_caption_entry(t)

        # --- Compose background and overlay layout items ---
        h, w = frame.shape[:2]
        bg: np.ndarray

        if background_spec.kind == "blur":
            scale_bg = max(frame_width / w, frame_height / h)
            dim_factor = background_spec.opacity if background_spec.opacity is not None else 0.55
            dim_factor = min(max(dim_factor, 0.0), 1.0)
            blur_kernel = background_spec.radius if background_spec.radius else blur_ksize
            if blur_kernel % 2 == 0:
                blur_kernel += 1
            if use_cuda:
                gpu_frame = cv2.cuda_GpuMat()
                gpu_frame.upload(frame)
                sz_bg = (int(w * scale_bg), int(h * scale_bg))
                gpu_bg = cv2.cuda.resize(gpu_frame, sz_bg)
                y0 = max(0, (sz_bg[1] - frame_height) // 2)
                x0 = max(0, (sz_bg[0] - frame_width) // 2)
                gpu_bg = gpu_bg.rowRange(y0, y0 + frame_height).colRange(x0, x0 + frame_width)
                if gpu_gauss is not None:
                    gpu_bg = gpu_gauss.apply(gpu_bg)
                    bg = gpu_bg.download()
                else:
                    bg = cv2.GaussianBlur(gpu_bg.download(), (blur_kernel, blur_kernel), 0)
                bg = cv2.addWeighted(bg, dim_factor, np.zeros_like(bg), 1 - dim_factor, 0)
            else:
                frame_u = cv2.UMat(frame)
                sz_bg = (int(w * scale_bg), int(h * scale_bg))
                bg_u = cv2.resize(frame_u, sz_bg)
                y0 = max(0, (sz_bg[1] - frame_height) // 2)
                x0 = max(0, (sz_bg[0] - frame_width) // 2)
                bg_nd = bg_u.get()
                bg_nd = bg_nd[y0:y0 + frame_height, x0:x0 + frame_width]
                small_w = max(2, frame_width // 4)
                small_h = max(2, frame_height // 4)
                small = cv2.resize(bg_nd, (small_w, small_h))
                small = cv2.GaussianBlur(small, (blur_kernel, blur_kernel), 0)
                bg = cv2.resize(small, (frame_width, frame_height))
                bg = cv2.addWeighted(bg, dim_factor, np.zeros_like(bg), 1 - dim_factor, 0)
        elif background_spec.kind == "color":
            color = _parse_color_hex(background_spec.color, (16, 16, 16))
            bg = np.full((frame_height, frame_width, 3), color, dtype=np.uint8)
        elif background_image is not None:
            bg = _resize_background_image(background_image)
        else:
            small = cv2.GaussianBlur(frame, (blur_ksize if blur_ksize % 2 == 1 else blur_ksize + 1, ) * 2, 0)
            bg = cv2.resize(small, (frame_width, frame_height))

        canvas = bg.copy()

        # Shape overlays
        for prepared_shape in prepared_layout.shapes:
            rect = prepared_shape.target.clamp(frame_width, frame_height)
            if rect.width <= 0 or rect.height <= 0:
                continue
            color = _parse_color_hex(prepared_shape.item.color, (0, 0, 0))
            opacity = max(0.0, min(1.0, prepared_shape.item.opacity))
            x0, y0 = rect.x, rect.y
            x1, y1 = rect.x + rect.width, rect.y + rect.height
            if opacity >= 1.0:
                canvas[y0:y1, x0:x1] = color
            else:
                overlay = np.full((rect.height, rect.width, 3), color, dtype=np.uint8)
                roi = canvas[y0:y1, x0:x1]
                cv2.addWeighted(overlay, opacity, roi, 1 - opacity, 0, dst=roi)

        # Video overlays
        for prepared_video in prepared_layout.videos:
            rect = prepared_video.target.clamp(frame_width, frame_height)
            if rect.width <= 0 or rect.height <= 0:
                continue
            crop = prepared_video.crop
            region = frame
            if crop is not None:
                if crop.units == "pixels":
                    crop_x = int(max(0, crop.x))
                    crop_y = int(max(0, crop.y))
                    crop_w = int(max(1, crop.width))
                    crop_h = int(max(1, crop.height))
                else:
                    crop_x = int(max(0, crop.x) * w)
                    crop_y = int(max(0, crop.y) * h)
                    crop_w = int(max(1, crop.width) * w)
                    crop_h = int(max(1, crop.height) * h)
                crop_x2 = min(w, crop_x + crop_w)
                crop_y2 = min(h, crop_y + crop_h)
                if crop_x2 > crop_x and crop_y2 > crop_y:
                    region = frame[crop_y:crop_y2, crop_x:crop_x2]
            if region.size == 0:
                continue
            if prepared_video.item.mirror:
                region = cv2.flip(region, 1)

            target_w = max(1, rect.width)
            target_h = max(1, rect.height)
            mode = prepared_video.item.scale_mode
            if mode == "fill":
                resized = cv2.resize(region, (target_w, target_h))
            else:
                src_h, src_w = region.shape[:2]
                scale_w = target_w / src_w
                scale_h = target_h / src_h
                if mode == "contain":
                    scale = min(scale_w, scale_h)
                    new_w = max(1, int(src_w * scale))
                    new_h = max(1, int(src_h * scale))
                    resized = cv2.resize(region, (new_w, new_h))
                    video_canvas = np.zeros((target_h, target_w, 3), dtype=np.uint8)
                    offset_x = (target_w - new_w) // 2
                    offset_y = (target_h - new_h) // 2
                    video_canvas[offset_y:offset_y + new_h, offset_x:offset_x + new_w] = resized
                    resized = video_canvas
                else:  # cover
                    scale = max(scale_w, scale_h)
                    new_w = max(1, int(src_w * scale))
                    new_h = max(1, int(src_h * scale))
                    resized = cv2.resize(region, (new_w, new_h))
                    offset_x = max(0, (new_w - target_w) // 2)
                    offset_y = max(0, (new_h - target_h) // 2)
                    resized = resized[offset_y:offset_y + target_h, offset_x:offset_x + target_w]

            opacity = prepared_video.item.opacity if prepared_video.item.opacity is not None else 1.0
            opacity = max(0.0, min(1.0, opacity))
            dest = canvas[rect.y:rect.y + target_h, rect.x:rect.x + target_w]
            if resized.shape[0] != target_h or resized.shape[1] != target_w:
                tmp = np.zeros((target_h, target_w, 3), dtype=np.uint8)
                hh = min(target_h, resized.shape[0])
                ww = min(target_w, resized.shape[1])
                tmp[:hh, :ww] = resized[:hh, :ww]
                resized = tmp
            if opacity >= 1.0:
                dest[:] = resized
            else:
                cv2.addWeighted(resized, opacity, dest, 1 - opacity, 0, dst=dest)

        # Text overlays
        for prepared_text in prepared_layout.texts:
            content = prepared_text.item.content.strip()
            if not content:
                continue
            rect = prepared_text.target.clamp(frame_width, frame_height)
            if rect.width <= 0 or rect.height <= 0:
                continue
            lines = content.splitlines()
            if not lines:
                lines = [content]
            text_scale = prepared_text.item.font_size
            if text_scale is None:
                text_scale = font_scale
            else:
                text_scale = max(0.3, float(text_scale) / 32.0 * font_scale)
            text_spacing = prepared_text.item.line_height
            if text_spacing is None:
                text_spacing = int(18 * (text_scale / font_scale))
            else:
                text_spacing = int(text_spacing)
            align_mode = prepared_text.item.align
            text_color = _parse_color_hex(prepared_text.item.color, fill_color)
            y_cursor = rect.y
            for ln in lines:
                if prepared_text.item.uppercase:
                    ln = ln.upper()
                (tw, th), _ = cv2.getTextSize(ln, font, text_scale, thickness + outline)
                if align_mode == "left":
                    x_text = rect.x
                elif align_mode == "right":
                    x_text = rect.x + max(0, rect.width - tw)
                else:
                    x_text = rect.x + max(0, (rect.width - tw) // 2)
                y_cursor += th
                for dx in (-outline, 0, outline):
                    for dy in (-outline, 0, outline):
                        if dx == 0 and dy == 0:
                            continue
                        cv2.putText(
                            canvas,
                            ln,
                            (x_text + dx, y_cursor + dy),
                            font,
                            text_scale,
                            outline_color,
                            thickness + outline,
                            line_type,
                        )
                cv2.putText(
                    canvas,
                    ln,
                    (x_text, y_cursor),
                    font,
                    text_scale,
                    text_color,
                    thickness,
                    line_type,
                )
                y_cursor += text_spacing

        # --- Captions ---
        effective_caption_rect = caption_rect or PixelRect(
            int(frame_width * 0.08),
            int(frame_height * 0.75),
            int(frame_width * 0.84),
            int(frame_height * 0.2),
        ).clamp(frame_width, frame_height)

        if current_entry is not None:
            words = _ensure_entry_words(current_entry)
            display_words = [w for w in words if w.text]
            line_text = " ".join(w.text for w in display_words).strip()
            if line_text:
                fs = font_scale * 1.25
                (tw, th), _ = cv2.getTextSize(line_text, font, fs, thickness + outline)
                max_text_w = max(1, caption_wrap_pixels)
                if tw > max_text_w:
                    scale_factor = max_text_w / max(tw, 1)
                    fs = fs * scale_factor
                    (tw, th), _ = cv2.getTextSize(line_text, font, fs, thickness + outline)
                available_h = max(0, effective_caption_rect.height)
                total_h = th
                if total_h > available_h and available_h > 0:
                    scale_factor = available_h / max(total_h, 1)
                    fs = fs * scale_factor
                    (tw, th), _ = cv2.getTextSize(line_text, font, fs, thickness + outline)
                    total_h = th
                bottom_safe = int(frame_height * bottom_safe_ratio)
                max_y = frame_height - bottom_safe - total_h
                y_text = max(0, min(effective_caption_rect.y, max_y))
                y_cursor = y_text + th

                if caption_align == "left":
                    x_text = effective_caption_rect.x
                elif caption_align == "right":
                    x_text = effective_caption_rect.x + max(0, effective_caption_rect.width - tw)
                else:
                    x_text = effective_caption_rect.x + max(0, (effective_caption_rect.width - tw) // 2)

                highlight_index: Optional[int] = None
                for idx, word in enumerate(display_words):
                    if (word.start - time_tolerance) <= t <= (word.end + time_tolerance):
                        highlight_index = idx
                        break
                if highlight_index is None and display_words:
                    if t < display_words[0].start:
                        highlight_index = 0
                    else:
                        highlight_index = len(display_words) - 1

                space_width = cv2.getTextSize(" ", font, fs, thickness + outline)[0][0]
                x_cursor = float(x_text)

                def _draw_token(token: str, origin_x: float, origin_y: int, color: Tuple[int, int, int]) -> None:
                    base_x = int(round(origin_x))
                    for dx in (-outline, 0, outline):
                        for dy in (-outline, 0, outline):
                            if dx == 0 and dy == 0:
                                continue
                            cv2.putText(
                                canvas,
                                token,
                                (base_x + dx, origin_y + dy),
                                font,
                                fs,
                                outline_color,
                                thickness + outline,
                                line_type,
                            )
                    cv2.putText(
                        canvas,
                        token,
                        (base_x, origin_y),
                        font,
                        fs,
                        color,
                        thickness,
                        line_type,
                    )

                for idx, word in enumerate(display_words):
                    token = word.text.strip()
                    if not token:
                        continue
                    (word_w, _), _ = cv2.getTextSize(token, font, fs, thickness + outline)
                    color = highlight_color if highlight_index == idx else base_caption_color
                    _draw_token(token, x_cursor, int(round(y_cursor)), color)
                    x_cursor += word_w
                    if idx != len(display_words) - 1:
                        x_cursor += space_width

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
