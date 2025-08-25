from __future__ import annotations

import os
import subprocess
import time
from pathlib import Path
from typing import Optional

from .candidates import ClipCandidate
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
    from moviepy import VideoFileClip, CompositeVideoClip, TextClip, ColorClip, vfx
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
) -> bool:
    """Take a horizontal clip and produce a 9:16 video with blurred background and burned subtitles.
    We assume `clip_path` is already trimmed to [global_start, global_end]. We still need `global_*` to build the SRT window.
    """
    clip = Path(clip_path)
    out = Path(output_path)
    out.parent.mkdir(parents=True, exist_ok=True)

    # Build a temp SRT aligned to this clip (0-based times)
    srt_path = out.with_suffix(".srt")
    build_srt_for_range(transcript_path, global_start=global_start, global_end=global_end, srt_path=srt_path)
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
        lines = extract_caption_lines_for_range(transcript_path, global_start=global_start, global_end=global_end)
        draw_filters = []
        for (rs, re, txt) in lines:
            wrapped = _wrap_text_for_drawtext(txt, max_chars=42)
            safe_txt = _escape_for_drawtext(wrapped)
            draw = (
                "drawtext=text='" + safe_txt + "'"
                + ":x=(w-text_w)/2:y=h-220:fontsize=" + str(font_size)
                + (f":fontfile='{font_file}'" if font_file else "")
                + ":fontcolor=white:box=1:boxcolor=black@0.5:boxborderw=10:line_spacing=12"
                + ":enable='between(t," + f"{rs:.3f},{re:.3f}" + ")'"
            )
            draw_filters.append(draw)
        caption_chain = ",".join(draw_filters) if draw_filters else "null"

    filter_complex = (
        f"[0:v]scale={target_w}:{target_h}:force_original_aspect_ratio=cover,boxblur={blur_strength}:1[bg];"
        f"[0:v]scale={target_w}:-2:force_original_aspect_ratio=decrease[fg];"
        f"[bg][fg]overlay=(W-w)/2:(H-h)/2,format=yuv420p,{caption_chain}[v]"
    )

    cmd = [
        "ffmpeg", "-y",
        "-i", str(clip),
        "-filter_complex", filter_complex,
        "-map", "[v]", "-map", "0:a?",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "18",
        "-c:a", "aac", "-movflags", "+faststart",
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
    font_size: int = 48,
    text_box_opacity: float = 0.55,
    text_color: str = "white",
    stroke_color: str = "black",
    stroke_width: int = 2,
    blur_radius: int = 25,
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

    # Build blurred background covering 9:16 (MoviePy v2+ compatible)
    # 1) scale to cover target H, 2) crop center to target W, 3) add dim overlay for readability
    bg = base.resized(height=target_h).with_effects([
        vfx.Crop(x_center=int(base.w/2), y_center=int(base.h/2), width=target_w, height=target_h)
    ])
    # Dim overlay to improve caption readability (since generic blur isn't available in v2 effects)
    dim_overlay = ColorClip(size=(target_w, target_h), color=(0, 0, 0)).with_opacity(0.35).with_duration(base.duration)

    # Foreground scaled to fit inside 9:16 without cropping
    scale_w = target_w
    fg = base.resized(width=scale_w)
    if fg.h > target_h:
        fg = base.resized(height=target_h)
    x_pos = (target_w - fg.w) // 2
    y_pos = (target_h - fg.h) // 2
    fg = fg.with_position((x_pos, y_pos))

    # Build timed caption overlays from transcript
    lines = extract_caption_lines_for_range(transcript_path, global_start=global_start, global_end=global_end)
    caption_clips = []
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
                size=(int(target_w*0.9), None),
                text_align="center",
            )
        except Exception as e:
            print(f"MOVIEPY: TextClip failed ({e}). Try installing ImageMagick and a valid font.")
            return False
        # Semi-opaque box behind text using a ColorClip
        pad_w, pad_h = 30, 10
        box = ColorClip(size=(tc.w + pad_w, tc.h + pad_h), color=(0, 0, 0)).with_opacity(text_box_opacity)

        # Shared timing and position (near bottom, centered)
        pos = ("center", target_h - int(target_h*0.18))
        tc = tc.with_start(rs).with_end(re).with_position(pos)
        box = box.with_start(rs).with_end(re).with_position(pos)

        # Add both box and text; they will stack in the main composite
        caption_clips.extend([box, tc])

    comp = CompositeVideoClip([bg, dim_overlay, fg] + caption_clips, size=(target_w, target_h))

    t0 = time.time()
    try:
        comp.write_videofile(
            str(out),
            codec="libx264",
            audio_codec="aac",
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
    ok = render_vertical_with_captions_moviepy(
        horiz_clip_path,
        transcript_path,
        global_start=candidate.start,
        global_end=candidate.end,
        output_path=out,
        target_w=target_w,
        target_h=target_h,
        font=font,
        font_size=font_size,
    )
    return out if ok else None

