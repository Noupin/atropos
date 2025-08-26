from __future__ import annotations

import os
import subprocess
import time
from pathlib import Path
from typing import Optional

from interfaces.clip_candidate import ClipCandidate
from .subtitle import (
    _escape_for_drawtext,
    _escape_for_subtitles_filter,
    _ffmpeg_supports_subtitles,
    _wrap_text_for_drawtext,
    build_srt_for_range,
    extract_caption_lines_for_range,
)

# Optional MoviePy backend (no ffmpeg subtitles filter)
try:
    from moviepy import (
        VideoFileClip,
        CompositeVideoClip,
        TextClip,
        ColorClip,
        vfx,
        Effect,
        Clip,
    )
    from dataclasses import dataclass
    from PIL import Image, ImageFilter
    import numpy as np
    _MOVIEPY_OK = True
except Exception:
    _MOVIEPY_OK = False


def render_vertical_with_captions(
    clip_path: str | Path,
    transcript_path: str | Path,
    *,
    global_start: float,
    global_end: float,
    output_path: str | Path,
    target_w: int = 1080,
    target_h: int = 1920,
    blur_strength: int = 20,
    font_file: Optional[str] = None,
    font_size: int = 42,
    prefer_subtitles: bool = False,
    srt_path: str | Path | None = None,
) -> bool:
    """Take a horizontal clip and produce a 9:16 video with blurred background and burned subtitles.
    We assume `clip_path` is already trimmed to [global_start, global_end]. We still need `global_*` to build the SRT window.
    """
    clip = Path(clip_path)
    out = Path(output_path)
    out.parent.mkdir(parents=True, exist_ok=True)

    # Build or reuse an SRT aligned to this clip (0-based times)
    if srt_path is None:
        srt_path = out.with_suffix(".srt")
    srt_path = Path(srt_path)
    if not srt_path.exists():
        build_srt_for_range(
            transcript_path,
            global_start=global_start,
            global_end=global_end,
            srt_path=srt_path,
        )
    srt_path = srt_path.resolve()

    has_subs = _ffmpeg_supports_subtitles()
    use_subs = prefer_subtitles and has_subs
    if use_subs:
        srt_escaped = _escape_for_subtitles_filter(srt_path)
        force_style = f"FontSize={font_size},OutlineColour=&H80000000,BorderStyle=3"
        caption_chain = f"subtitles='{srt_escaped}':force_style='{force_style}'"
    else:
        if prefer_subtitles and not has_subs:
            print("VERTICAL: 'subtitles' filter not available; using drawtext fallback.")
        # Build drawtext overlays per line
        lines = extract_caption_lines_for_range(
            transcript_path, global_start=global_start, global_end=global_end
        )
        draw_filters = []
        # Position captions a bit higher to avoid overlap with bottom screen text
        bottom_margin = int(target_h * 0.25)
        for (rs, re, txt) in lines:
            wrapped = _wrap_text_for_drawtext(txt, max_chars=42)
            safe_txt = _escape_for_drawtext(wrapped)
            draw = (
                "drawtext=text='" + safe_txt + "'"
                + f":x=(w-text_w)/2:y=h-{bottom_margin}:fontsize=" + str(font_size)
                + (f":fontfile='{font_file}'" if font_file else "")
                + ":fontcolor=white:box=1:boxcolor=black@0.5:boxborderw=10:line_spacing=12"
                + ":enable='between(t," + f"{rs:.3f},{re:.3f}" + ")'"
            )
            draw_filters.append(draw)
        caption_chain = ",".join(draw_filters) if draw_filters else "null"

    filter_complex = (
        f"[0:v]scale={target_w}:{target_h}:force_original_aspect_ratio=increase,crop={target_w}:{target_h},boxblur={blur_strength}:1[bg];"
        f"[0:v]scale={target_w}:-2:force_original_aspect_ratio=decrease[fg];"
        f"[bg][fg]overlay=(W-w)/2:(H-h)/2,format=yuv420p,{caption_chain}[v]"
    )

    cmd = [
        "ffmpeg", "-y",
        "-i", str(clip),
        "-filter_complex", filter_complex,
        "-map", "[v]", "-map", "0:a?",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "18",
        "-c:a", "aac", "-b:a", "256k", "-movflags", "+faststart",
        str(out),
    ]

    t0 = time.time()
    try:
        subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True)
        print(f"VERTICAL: wrote {out.name} in {time.time()-t0:.2f}s")
        return True
    except subprocess.CalledProcessError as e:
        stderr_txt = e.stderr.decode(errors='ignore') if e.stderr else ''
        print("VERTICAL CMD:", " ".join(cmd))
        print(f"VERTICAL: failed -> {e}\nSTDERR:\n{stderr_txt}")
        return False


def render_vertical_from_candidate(
    clip_path: str | Path,
    transcript_path: str | Path,
    candidate: ClipCandidate,
    output_dir: str | Path,
    *,
    target_w: int = 1080,
    target_h: int = 1920,
    blur_strength: int = 20,
    font_file: Optional[str] = None,
    font_size: int = 42,
    prefer_subtitles: bool = False,
    srt_path: str | Path | None = None,
) -> Path | None:
    out = Path(output_dir) / f"clip_vertical_{candidate.start:.2f}-{candidate.end:.2f}_r{candidate.rating:.1f}.mp4"
    ok = render_vertical_with_captions(
        clip_path,
        transcript_path,
        global_start=candidate.start,
        global_end=candidate.end,
        output_path=out,
        target_w=target_w,
        target_h=target_h,
        blur_strength=blur_strength,
        font_file=font_file,
        font_size=font_size,
        prefer_subtitles=prefer_subtitles,
        srt_path=srt_path,
    )
    return out if ok else None

# -----------------------------
# Vertical (9:16) render with captions via MoviePy (no ffmpeg subtitles filter)
# -----------------------------

def render_vertical_with_captions_moviepy(
    clip_path: str | Path,
    transcript_path: str | Path,
    *,
    global_start: float,
    global_end: float,
    output_path: str | Path,
    target_w: int = 1080,
    target_h: int = 1920,
    font: str | None = None,
    font_size: int = 56,
    text_box_opacity: float = 0.00,  # use outline by default
    text_color: str = "white",
    stroke_color: str = "black",
    stroke_width: int = 6,
    blur_radius: int = 25,
    # Foreground layout
    fg_height_ratio: float = 0.58,   # portion of 9:16 height occupied by FG (less zoom)
    fg_vertical_bias: float = 0.04,  # slightly less upward bias
    crop_left_right: float = 0.04,   # crop a little from sides before scaling
    descender_pad: int = 18,
    preserve_source_audio: bool = True,
) -> bool:
    """Render a 9:16 clip with burned captions using MoviePy TextClip overlays.
    This avoids the ffmpeg subtitles/drawtext filters entirely.
    NOTE: TextClip may require ImageMagick on macOS. Install via: `brew install imagemagick`.
    """
    if not _MOVIEPY_OK:
        print("MOVIEPY: not available. Please `pip install moviepy`.")
        return False

    clip_path = Path(clip_path)
    out = Path(output_path)
    out.parent.mkdir(parents=True, exist_ok=True)

    # Load base clip
    base = VideoFileClip(str(clip_path)).subclipped(start_time=0, end_time=max(0.01, global_end - global_start))

    @dataclass
    class GaussianBlur(Effect):
        radius: float

        def apply(self, clip: Clip) -> Clip:
            def fl(gf, t):
                frame = gf(t)
                img = Image.fromarray(frame)
                return np.array(img.filter(ImageFilter.GaussianBlur(self.radius)))

            return clip.transform(fl)

    # Build blurred background covering 9:16
    bg = (
        base.resized(height=target_h)
        .with_effects([GaussianBlur(blur_radius), vfx.Crop(x_center=int(base.w/2), y_center=int(base.h/2), width=target_w, height=target_h)])
    )
    # Guarantee exact canvas match after effects
    bg = bg.resized((target_w, target_h)).with_position((0, 0))
    # Dim overlay for readability
    dim_overlay = (
        ColorClip(size=(target_w, target_h), color=(0, 0, 0))
        .with_opacity(0.45)
        .with_duration(base.duration)
    )

    # Foreground: crop narrow edges, then scale to a fixed portion of the 9:16 height
    fg = base
    if crop_left_right > 0:
        crop_px = int(base.w * crop_left_right)
        fg = fg.with_effects([
            vfx.Crop(x1=crop_px, x2=base.w - crop_px, y1=0, y2=base.h)
        ])

    # Target FG height as a ratio of the vertical canvas
    fg_h = max(100, int(target_h * fg_height_ratio))
    fg = fg.resized(height=fg_h)
    # Center horizontally; bias vertically upwards so captions can sit beneath FG
    x_pos = (target_w - fg.w) // 2
    # Compute top based on bias: 0.5 places FG center; subtract bias to move up
    center_y = int(target_h * (0.5 - fg_vertical_bias))
    y_pos = max(0, center_y - fg.h // 2)
    fg = fg.with_position((x_pos, y_pos))
    fg_top, fg_bottom = y_pos, y_pos + fg.h

    # Build timed caption overlays from transcript
    lines = extract_caption_lines_for_range(transcript_path, global_start=global_start, global_end=global_end)
    caption_clips = []
    bottom_safe = int(target_h * 0.14)  # a bit more safety to avoid cutoff
    gap_below_fg = 28                   # more space under FG
    for (rs, re, txt) in lines:
        if not txt.strip():
            continue
        # Wrap long lines for reels-safe area
        wrapped = txt
        if len(txt) > 44:
            wrapped = "\n".join(_wrap_text_for_drawtext(txt, max_chars=44).split("\\n"))
        try:
            tc = TextClip(
                text=wrapped,
                font=font if font else None,
                font_size=font_size,
                color=text_color,
                stroke_color=stroke_color,
                stroke_width=stroke_width,
                method="caption",
                size=(int(target_w * 0.86), None),
                text_align="center",
            )
            tc = tc.with_effects([vfx.Margin(bottom=descender_pad)])
            effective_h = tc.h + (stroke_width * 2) + descender_pad
        except Exception as e:
            print(
                f"MOVIEPY: TextClip failed ({e}). Try installing ImageMagick and a valid font."
            )
            return False
        # Preferred position: just under the foreground
        under_fg_y = fg_bottom + gap_below_fg
        max_y = target_h - bottom_safe - effective_h
        pos_y = min(under_fg_y, max_y)
        pos = ("center", max(0, pos_y))

        # Optional box behind text (default opacity 0 -> off)
        clips_to_add = []
        if text_box_opacity > 0.0:
            pad_w, pad_h = 28, 16
            box = (
                ColorClip(size=(tc.w + pad_w, tc.h + pad_h), color=(0, 0, 0))
                .with_opacity(text_box_opacity)
                .with_start(rs).with_end(re).with_position(pos)
            )
            clips_to_add.append(box)

        tc = tc.with_start(rs).with_end(re).with_position(pos)
        clips_to_add.append(tc)
        caption_clips.extend(clips_to_add)

    comp = CompositeVideoClip([bg, dim_overlay, fg] + caption_clips, size=(target_w, target_h))

    # Ensure composite uses the original audio track (not bg/overlays)
    try:
        comp = comp.with_audio(base.audio)
    except Exception:
        pass

    t0 = time.time()
    try:
        if preserve_source_audio:
            # 1) Render video-only to a temp file
            tmp_video_only = out.with_suffix(".video.mp4")
            comp.write_videofile(
                str(tmp_video_only),
                codec="libx264",
                audio=False,
                preset="veryfast",
                ffmpeg_params=["-movflags", "+faststart"],
                threads=os.cpu_count() or 4,
                logger=None,
            )
            # 2) Mux original audio from the horizontal clip without re-encoding
            mux_cmd = [
                "ffmpeg", "-y",
                "-i", str(tmp_video_only),
                "-i", str(clip_path),
                "-map", "0:v:0", "-map", "1:a:0?",
                "-c:v", "copy", "-c:a", "copy",
                str(out),
            ]
            try:
                subprocess.run(mux_cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True)
            finally:
                try:
                    os.remove(tmp_video_only)
                except OSError:
                    pass
        else:
            # Encode audio at a healthy bitrate/sample rate
            comp.write_videofile(
                str(out),
                codec="libx264",
                audio_codec="aac",
                audio_bitrate="320k",
                audio_fps=48000,
                preset="veryfast",
                ffmpeg_params=["-movflags", "+faststart"],
                threads=os.cpu_count() or 4,
                logger=None,
            )
        print(f"MOVIEPY: wrote {out.name} in {time.time()-t0:.2f}s")
        return True
    except Exception as e:
        print(f"MOVIEPY: failed -> {e}")
        return False
    finally:
        comp.close(); bg.close(); fg.close(); base.close()


def render_vertical_from_candidate_moviepy(
    horiz_clip_path: str | Path,
    transcript_path: str | Path,
    candidate: ClipCandidate,
    output_dir: str | Path,
    *,
    target_w: int = 1080,
    target_h: int = 1920,
    font: str | None = None,
    font_size: int = 48,
) -> Path | None:
    out = Path(output_dir) / f"clip_vertical_{candidate.start:.2f}-{candidate.end:.2f}_r{candidate.rating:.1f}.mp4"
    v_ok = render_vertical_with_captions_moviepy(
        horiz_clip_path,
        transcript_path,
        global_start=candidate.start,
        global_end=candidate.end,
        output_path=out,
        target_w=target_w,
        target_h=target_h,
        font=font,
        font_size=font_size,
        preserve_source_audio=True,
    )
    return out if v_ok else None
