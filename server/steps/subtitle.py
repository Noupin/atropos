from __future__ import annotations

from pathlib import Path
from typing import List, Tuple
import subprocess

from .candidates import parse_transcript


def extract_caption_lines_for_range(
    transcript_path: str | Path,
    *,
    global_start: float,
    global_end: float,
    min_line_dur: float = 0.40,
) -> List[Tuple[float, float, str]]:
    """Return [(rel_start, rel_end, text), ...] for lines overlapping [global_start, global_end).
    rel_* are relative to global_start (i.e., clip-local time).
    """
    items = parse_transcript(transcript_path)
    lines: List[Tuple[float, float, str]] = []
    for (s, e, text) in items:
        if e <= global_start or s >= global_end:
            continue
        rs = max(0.0, s - global_start)
        re = max(rs + min_line_dur, min(global_end, e) - global_start)
        txt = (text or "").replace("\n", " ").strip()
        if not txt:
            continue
        lines.append((rs, re, txt))
    if not lines:
        # Ensure at least one placeholder line so renderers don't choke
        lines = [(0.0, max(0.8, global_end - global_start), " ")]
    return lines

# -----------------------------
# Subtitle / SRT utilities
# -----------------------------


def _fmt_ts(seconds: float) -> str:
    if seconds < 0:
        seconds = 0.0
    ms = int(round((seconds - int(seconds)) * 1000))
    s = int(seconds) % 60
    m = (int(seconds) // 60) % 60
    h = int(seconds) // 3600
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


# -----------------------------
# FFmpeg capability + path escaping helpers
# -----------------------------

def _ffmpeg_supports_subtitles() -> bool:
    try:
        out = subprocess.run(["ffmpeg", "-hide_banner", "-filters"], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, check=True)
        text = out.stdout.decode(errors="ignore")
        return "subtitles" in text
    except Exception:
        return False


def _escape_for_subtitles_filter(path: Path) -> str:
    # Escape characters that break filter args: ":, ' and backslashes
    s = path.as_posix()
    s = s.replace("\\", "\\\\").replace(":", "\\:").replace(",", "\\,").replace("'", "\\'")
    return s

# -----------------------------
# Drawtext helpers
# -----------------------------
def _escape_for_drawtext(text: str) -> str:
    # Escape characters that break ffmpeg filtergraph parsing inside drawtext values
    # - backslash, single quote, colon, comma, semicolon, percent, newline
    s = text
    s = s.replace("\\", "\\\\")
    s = s.replace("'", "\\'")
    s = s.replace(":", "\\:")
    s = s.replace(",", "\\,")
    s = s.replace(";", "\\;")
    s = s.replace("%", "\\%")
    s = s.replace("\n", "\\n")
    return s

def _wrap_text_for_drawtext(text: str, max_chars: int = 42) -> str:
    # Simple greedy wrap by spaces; returns text with \n for drawtext
    words = text.split()
    if not words:
        return ""
    lines = []
    cur = []
    cur_len = 0
    for w in words:
        if cur_len + (1 if cur else 0) + len(w) > max_chars:
            lines.append(" ".join(cur))
            cur = [w]
            cur_len = len(w)
        else:
            cur.append(w)
            cur_len += (1 if cur_len else 0) + len(w)
    if cur:
        lines.append(" ".join(cur))
    return "\\n".join(lines)

# -----------------------------
# Subtitle / SRT utilities
# -----------------------------


def build_srt_for_range(
    transcript_path: str | Path,
    *,
    global_start: float,
    global_end: float,
    srt_path: str | Path,
    min_line_dur: float = 0.40,
) -> Path:
    """Create an SRT file covering [global_start, global_end) using transcript lines.
    Line times are shifted so the SRT starts at 00:00:00,000.
    """
    items = parse_transcript(transcript_path)
    lines = []
    for (s, e, text) in items:
        if e <= global_start or s >= global_end:
            continue
        rs = max(0.0, s - global_start)
        re = max(rs + min_line_dur, min(global_end, e) - global_start)
        txt = (text or "").replace("\n", " ").strip()
        if not txt:
            continue
        lines.append((rs, re, txt))
    # Harden: If no lines, create a minimal placeholder to avoid filter errors
    if not lines:
        # Ensure file exists to avoid filter errors; create a tiny placeholder
        lines = [(0.0, max(0.8, global_end - global_start), " ")]
    out = Path(srt_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    with out.open("w", encoding="utf-8") as f:
        for idx, (rs, re, txt) in enumerate(lines, start=1):
            f.write(f"{idx}\n{_fmt_ts(rs)} --> { _fmt_ts(re) }\n{txt}\n\n")
    return out

