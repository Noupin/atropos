from __future__ import annotations

from pathlib import Path

from .candidates import parse_transcript

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
    raw_lines = []
    for (s, e, text) in items:
        if e <= global_start or s >= global_end:
            continue
        rs = max(0.0, s - global_start)
        re = max(rs + min_line_dur, min(global_end, e) - global_start)
        txt = (text or "").replace("\n", " ").strip()
        if not txt:
            continue
        raw_lines.append((rs, re, txt))
    if not raw_lines:
        raw_lines = [(0.0, max(0.8, global_end - global_start), " ")]

    # Clamp overlaps to avoid stacked subtitles
    raw_lines.sort(key=lambda x: x[0])
    lines = []
    for idx, (rs, re, txt) in enumerate(raw_lines):
        next_start = raw_lines[idx + 1][0] if idx + 1 < len(raw_lines) else None
        if next_start is not None and re > next_start:
            re = max(rs + min_line_dur, next_start)
        lines.append((rs, re, txt))
    out = Path(srt_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    with out.open("w", encoding="utf-8") as f:
        for idx, (rs, re, txt) in enumerate(lines, start=1):
            f.write(f"{idx}\n{_fmt_ts(rs)} --> { _fmt_ts(re) }\n{txt}\n\n")
    return out

