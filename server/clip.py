from __future__ import annotations
# -----------------------------
# Safe field helpers
# -----------------------------

def _get_field(obj, key, default=None):
    """Return obj[key] if dict-like, getattr(obj, key) if attribute-like, else default."""
    if isinstance(obj, dict):
        return obj.get(key, default)
    return getattr(obj, key, default)

def _to_float(val):
    try:
        return float(val)
    except Exception:
        return None
from dataclasses import dataclass
from typing import List, Optional, Tuple, Iterable, Dict
import json
import re
import os
import subprocess
import time

import requests
from pathlib import Path
import math
import itertools
from requests.exceptions import RequestException

# Optional MoviePy backend (no ffmpeg subtitles filter)
try:
    from moviepy import VideoFileClip, CompositeVideoClip, TextClip, ColorClip, vfx
    _MOVIEPY_OK = True
except Exception:
    _MOVIEPY_OK = False

# -----------------------------
# Data structures
# -----------------------------


@dataclass
class ClipCandidate:
    start: float
    end: float
    rating: float
    reason: str
    quote: str

    def duration(self) -> float:
        return max(0.0, self.end - self.start)

# -----------------------------
# Manifest utils (export/import candidates)
# -----------------------------

def export_candidates_json(candidates: List[ClipCandidate], path: str | Path) -> None:
    out = Path(path)
    out.parent.mkdir(parents=True, exist_ok=True)
    payload = [
        {
            "start": c.start,
            "end": c.end,
            "rating": c.rating,
            "reason": c.reason,
            "quote": c.quote,
        }
        for c in candidates
    ]
    out.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def load_candidates_json(path: str | Path) -> List[ClipCandidate]:
    p = Path(path)
    data = json.loads(p.read_text(encoding="utf-8"))
    result: List[ClipCandidate] = []
    for it in data:
        start = _to_float(_get_field(it, "start"))
        end = _to_float(_get_field(it, "end"))
        rating = _to_float(_get_field(it, "rating"))
        reason = str(_get_field(it, "reason", ""))
        quote = str(_get_field(it, "quote", ""))
        if start is None or end is None or rating is None:
            continue
        result.append(ClipCandidate(start=start, end=end, rating=rating, reason=reason, quote=quote))
    return result

# -----------------------------
# Transcript utilities
# -----------------------------

_TIME_RANGE = re.compile(r"^\[(?P<start>\d+(?:\.\d+)?)\s*->\s*(?P<end>\d+(?:\.\d+)?)\]\s*(?P<text>.*)$")


def parse_transcript(transcript_path: str | Path) -> List[Tuple[float, float, str]]:
    """Read a transcript .txt with lines like: `[12.34 -> 17.89] text`.
    Returns list of (start, end, text).
    """
    items: List[Tuple[float, float, str]] = []
    p = Path(transcript_path)
    if not p.exists():
        raise FileNotFoundError(f"Transcript not found: {transcript_path}")
    with p.open("r", encoding="utf-8") as f:
        for line in f:
            m = _TIME_RANGE.match(line.strip())
            if not m:
                continue
            start = float(m.group("start"))
            end = float(m.group("end"))
            text = m.group("text").strip()
            if text:
                items.append((start, end, text))
    return items

# -----------------------------
# Clip sanity utilities (snap ends to segment boundaries, prevent overlap)
# -----------------------------

def _build_segment_index(items: List[Tuple[float, float, str]]):
    """Return parallel lists of segment starts and ends for binary search."""
    starts = [s for s, _, _ in items]
    ends = [e for _, e, _ in items]
    return starts, ends



def _snap_end_to_segment_end(end_time: float, items: List[Tuple[float, float, str]]) -> float:
    """If end_time lands inside a spoken segment, snap to that segment's end so we don't cut into the next line.
    If it lands in silence between segments, return unchanged.
    """
    # Linear scan is fine for typical transcript sizes; optimize later if needed
    for s, e, _ in items:
        if s <= end_time <= e:
            return e
    return end_time


# SNAP START TO SEGMENT START
def _snap_start_to_segment_start(start_time: float, items: List[Tuple[float, float, str]]) -> float:
    """If start_time lands inside a spoken segment, snap to that segment's start so we don't cut mid-line.
    If it lands in silence between segments, return unchanged.
    """
    for s, e, _ in items:
        if s <= start_time <= e:
            return s
    return start_time



# MERGE ADJACENT/OVERLAPPING CANDIDATES
def _merge_adjacent_candidates(
    candidates: List[ClipCandidate],
    items: List[Tuple[float, float, str]],
    *,
    merge_gap_seconds: float = 1.5,
    max_duration_seconds: float = 120.0,
) -> List[ClipCandidate]:
    """Merge candidates that overlap or are separated by a tiny gap, to preserve full jokes/bits.
    - Snap starts/ends to segment boundaries before merging.
    - If merged duration would exceed max_duration_seconds, keep as-is (no merge for that pair).
    """
    if not candidates:
        return []

    # Snap both ends first
    snapped: List[ClipCandidate] = []
    for c in candidates:
        s = _snap_start_to_segment_start(c.start, items)
        e = _snap_end_to_segment_end(c.end, items)
        if e <= s:
            continue
        snapped.append(ClipCandidate(start=s, end=e, rating=c.rating, reason=c.reason, quote=c.quote))

    if not snapped:
        return []

    # Sort by start time
    snapped.sort(key=lambda c: (c.start, c.end))

    merged: List[ClipCandidate] = []
    cur = snapped[0]

    for nxt in snapped[1:]:
        gap = nxt.start - cur.end
        overlap = gap <= 0
        tiny_gap = 0 <= gap <= merge_gap_seconds
        if overlap or tiny_gap:
            new_start = min(cur.start, nxt.start)
            new_end = max(cur.end, nxt.end)
            if (new_end - new_start) <= max_duration_seconds:
                # Merge: keep the higher rating, concatenate reasons/quotes
                cur = ClipCandidate(
                    start=new_start,
                    end=new_end,
                    rating=max(cur.rating, nxt.rating),
                    reason=(cur.reason + (" | " if cur.reason and nxt.reason else "") + nxt.reason).strip(),
                    quote=(cur.quote + (" | " if cur.quote and nxt.quote else "") + nxt.quote).strip(),
                )
                continue
        # Cannot merge, push current and advance
        merged.append(cur)
        cur = nxt

    merged.append(cur)
    return merged


def _enforce_non_overlap(candidates: List[ClipCandidate], items: List[Tuple[float, float, str]], min_gap: float = 0.10) -> List[ClipCandidate]:
    """Adjusts candidate ends to segment boundaries and removes overlaps.
    Preference is given to higher-rated candidates when overlaps occur.
    Returns a list sorted by start time.
    Assumes starts are already snapped, but will snap both ends for safety.
    """
    if not candidates:
        return []

    # 1) Snap both starts and ends so we don't cut into new speech or mid-line
    adjusted: List[ClipCandidate] = []
    for c in candidates:
        snapped_start = _snap_start_to_segment_start(c.start, items)
        snapped_end = _snap_end_to_segment_end(c.end, items)
        if snapped_end <= snapped_start:
            continue
        adjusted.append(ClipCandidate(start=snapped_start, end=snapped_end, rating=c.rating, reason=c.reason, quote=c.quote))

    if not adjusted:
        return []

    # 2) Select non-overlapping by rating desc, then earlier start
    adjusted.sort(key=lambda x: (-x.rating, x.start, x.end))
    selected: List[ClipCandidate] = []

    def overlaps(a: ClipCandidate, b: ClipCandidate) -> bool:
        return not (a.end + min_gap <= b.start or b.end + min_gap <= a.start)

    for cand in adjusted:
        if any(overlaps(cand, s) for s in selected):
            continue
        selected.append(cand)

    # 3) Sort chronologically for output
    selected.sort(key=lambda x: x.start)
    return selected

# -----------------------------
# LLM (Ollama / gemma3) utilities
# -----------------------------

OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://localhost:11434")


def _ollama_generate(model: str, prompt: str, json_format: bool = True, options: Optional[dict] = None, timeout: int = 120) -> str:
    """Call Ollama's /api/generate with optional JSON formatting.
    Returns the raw response string.
    """
    payload = {
        "model": model,
        "prompt": prompt,
        "stream": False,
    }
    if json_format:
        payload["format"] = "json"
    if options:
        payload["options"] = options
    url = f"{OLLAMA_URL}/api/generate"
    resp = requests.post(url, json=payload, timeout=timeout)
    resp.raise_for_status()
    data = resp.json()
    return data.get("response", "").strip()

# -----------------------------
# Batching, retries, and orchestration
# -----------------------------

DEFAULT_JSON_EXTRACT = re.compile(r"\[(?:.|\n)*\]")


def _chunk_transcript_items(items: List[Tuple[float, float, str]], *, max_chars: int = 12000, overlap_lines: int = 4) -> List[List[Tuple[float, float, str]]]:
    """Chunk transcript into pieces under a character budget with a small line overlap to avoid split jokes."""
    chunks: List[List[Tuple[float, float, str]]] = []
    buf: List[Tuple[float, float, str]] = []
    count = 0
    for triplet in items:
        s, e, t = triplet
        line_len = len(t) + 20  # include time-coding overhead
        if buf and (count + line_len) > max_chars:
            # push chunk with optional overlap
            chunks.append(buf[:])
            # seed with overlap tail
            tail = buf[-overlap_lines:] if overlap_lines > 0 else []
            buf = tail[:]
            count = sum(len(x[2]) + 20 for x in buf)
        buf.append(triplet)
        count += line_len
    if buf:
        chunks.append(buf)
    return chunks


def _format_items_for_prompt(items: List[Tuple[float, float, str]]) -> str:
    return "\n".join(f"[{s:.2f}-{e:.2f}] {t}" for s, e, t in items)


def _ollama_call_json(model: str, prompt: str, *, options: Optional[dict] = None, timeout: int = 120) -> List[Dict]:
    """Call Ollama and return parsed JSON array with robust fallback and small cleanup."""
    try:
        raw = _ollama_generate(model=model, prompt=prompt, json_format=True, options=options, timeout=timeout)
    except RequestException as e:
        raise RuntimeError(f"Ollama request failed: {e}")
    # Direct parse
    try:
        parsed = json.loads(raw)
        if isinstance(parsed, dict) and "items" in parsed:
            parsed = parsed["items"]
        if isinstance(parsed, list):
            return parsed
    except Exception:
        pass
    # Fallback: extract first JSON array
    m = DEFAULT_JSON_EXTRACT.search(raw)
    if not m:
        raise ValueError(f"Model did not return JSON array. Raw head: {raw[:300]}")
    return json.loads(m.group(0))


def _retry(fn, *, attempts: int = 3, backoff: float = 1.5):
    last_exc = None
    delay = 0.8
    for i in range(attempts):
        try:
            return fn()
        except Exception as e:
            last_exc = e
            time.sleep(delay)
            delay *= backoff
    raise last_exc


def find_funny_timestamps_batched(
    transcript_path: str | Path,
    *,
    min_rating: float = 7.0,
    model: str = "gemma3",
    options: Optional[dict] = None,
    max_chars_per_chunk: int = 12000,
    overlap_lines: int = 4,
    request_timeout: int = 180,
    exclude_ranges: Optional[List[Tuple[float, float]]] = None,
) -> List[ClipCandidate]:
    """Chunk the transcript and query the model per-chunk to avoid context/HTTP timeouts.

    - `exclude_ranges`: optional list of (start, end) ranges already chosen; we will ignore overlapping results.
    - Returns a non-overlapping, end-snapped set of ClipCandidates across the whole file.
    """
    items = parse_transcript(transcript_path)
    if not items:
        return []

    chunks = _chunk_transcript_items(items, max_chars=max_chars_per_chunk, overlap_lines=overlap_lines)
    print(f"[Batch] Processing {len(chunks)} transcript chunks...")

    system_instructions = (
        "You are ranking humorous or high-likelihood viral clip moments."
        " Consider punchlines, callbacks, playful insults, crowd laughter cues, exaggerated reactions, or topic pivots."
        " Return a JSON array ONLY."
        " Each item MUST be: {\"start\": number, \"end\": number, \"rating\": 1-10 number, \"reason\": string, \"quote\": string}."
        f" Include ONLY items with rating >= {min_rating}."
        " Use the provided time ranges; do not invent timestamps outside them."
        " Prefer segment boundaries but you may merge adjacent lines if a joke spans them."
    )

    all_candidates: List[ClipCandidate] = []
    min_ts = items[0][0]
    max_ts = max(e for _, e, _ in items)

    # Gentle model options for longer prompts
    combined_options = {"temperature": 0.2, "num_ctx": 8192}
    if options:
        combined_options.update(options)

    for idx, chunk in enumerate(chunks):
        print(f"[Batch] Processing chunk {idx+1}/{len(chunks)} with {len(chunk)} lines...")
        condensed = _format_items_for_prompt(chunk)
        prompt = (
            f"{system_instructions}\n\nTRANSCRIPT (time-coded):\n{condensed}\n\nReturn JSON now."
        )
        def _call():
            arr = _ollama_call_json(model=model, prompt=prompt, options=combined_options, timeout=request_timeout)
            return arr
        try:
            arr = _retry(_call)
        except Exception as e:
            # Skip this chunk on repeated failure
            print(f"Ollama chunk failed, skipping: {e}")
            continue
        print(f"[Batch] Chunk {idx+1}: Model returned {len(arr)} raw candidates.")
        for it in arr:
            start = _to_float(_get_field(it, "start"))
            end = _to_float(_get_field(it, "end"))
            rating = _to_float(_get_field(it, "rating"))
            reason = str(_get_field(it, "reason", "")).strip()
            quote = str(_get_field(it, "quote", "")).strip()
            if start is None or end is None or rating is None:
                # Skip malformed candidate
                continue
            if not (min_ts <= start < end <= max_ts):
                continue
            if rating < min_rating:
                continue
            all_candidates.append(ClipCandidate(start=start, end=end, rating=rating, reason=reason, quote=quote))

    # Optionally filter out overlaps with previously selected clips
    if exclude_ranges:
        def overlaps_any(c: ClipCandidate) -> bool:
            for a, b in exclude_ranges:
                if not (c.end <= a or c.start >= b):
                    return True
            return False
        all_candidates = [c for c in all_candidates if not overlaps_any(c)]

    print(f"[Batch] Collected {len(all_candidates)} raw candidates across all chunks. Merging and enforcing non-overlap...")
    # Merge adjacent/overlapping candidates into full bits before non-overlap selection
    all_candidates = _merge_adjacent_candidates(all_candidates, items, merge_gap_seconds=1.5, max_duration_seconds=120.0)
    # Enforce snapping and non-overlap globally
    result = _enforce_non_overlap(all_candidates, items)
    print(f"[Batch] {len(result)} candidates remain after overlap enforcement.")
    return result

# -----------------------------
# LLM (Ollama / gemma3) utilities
# -----------------------------

def find_funny_timestamps(
    transcript_path: str | Path,
    min_rating: float = 7.0,
    model: str = "gemma3",
    options: Optional[dict] = None,
) -> List[ClipCandidate]:
    """Use a local Ollama model (gemma3) to score transcript lines and propose clip windows.

    Strategy: send a condensed transcript where each line embeds its time range.
    The model returns JSON with objects: {start, end, rating, reason, quote}.
    We keep all with rating >= min_rating.
    """
    items = parse_transcript(transcript_path)
    if not items:
        return []

    # Boundaries for safety clipping
    min_ts = items[0][0]
    max_ts = max(e for _, e, _ in items)

    # Build condensed transcript string
    condensed_lines = [f"[{s:.2f}-{e:.2f}] {t}" for s, e, t in items]
    MAX_SINGLE_CHARS = 12000
    condensed = []
    total = 0
    for line in condensed_lines:
        ln = len(line) + 1
        if total + ln > MAX_SINGLE_CHARS:
            break
        condensed.append(line)
        total += ln
    condensed = "\n".join(condensed)

    system_instructions = (
        "You are ranking humorous or high-likelihood viral clip moments."
        " Consider punchlines, callbacks, playful insults, crowd laughter cues,"
        " exaggerated reactions, or obvious topic pivots."
        " Return a JSON array ONLY."
        " Each item MUST be: {\"start\": number, \"end\": number, \"rating\": 1-10 number, \"reason\": string, \"quote\": string}."
        f" Include ONLY items with rating >= {min_rating}."
        " Use the provided time ranges; do not invent timestamps outside them."
        " Prefer segment boundaries but you may merge adjacent lines if a joke spans them."
    )

    prompt = (
        f"{system_instructions}\n\n"
        f"TRANSCRIPT (time-coded):\n{condensed}\n\n"
        "Return JSON now."
    )

    print("[Single] Sending transcript to model for funny timestamp extraction...")
    raw = _ollama_generate(model=model, prompt=prompt, json_format=True, options=options)

    # Parse JSON safely
    try:
        parsed = json.loads(raw)
        if isinstance(parsed, dict) and "items" in parsed:
            parsed = parsed["items"]
        if not isinstance(parsed, list):
            raise ValueError("Model did not return a JSON array")
    except Exception:
        # Try to salvage by extracting the first JSON array
        m = re.search(r"\[(?:.|\n)*\]", raw)
        if not m:
            raise ValueError(f"Model did not return valid JSON. Raw: {raw[:500]}")
        parsed = json.loads(m.group(0))

    print(f"[Single] Model returned {len(parsed)} raw candidates before filtering.")
    candidates: List[ClipCandidate] = []
    for it in parsed:
        start = _to_float(_get_field(it, "start"))
        end = _to_float(_get_field(it, "end"))
        rating = _to_float(_get_field(it, "rating"))
        reason = str(_get_field(it, "reason", "")).strip()
        quote = str(_get_field(it, "quote", "")).strip()
        if start is None or end is None or rating is None:
            # Skip malformed candidate
            continue
        # Clamp and validate
        if not (min_ts <= start < end <= max_ts):
            continue
        if rating < min_rating:
            continue
        candidates.append(ClipCandidate(start=start, end=end, rating=rating, reason=reason, quote=quote))

    # Merge adjacent/overlapping candidates into full bits before non-overlap selection
    candidates = _merge_adjacent_candidates(candidates, items, merge_gap_seconds=1.5, max_duration_seconds=120.0)
    # Snap to segment ends and prevent overlapping clips
    candidates = _enforce_non_overlap(candidates, items)
    return candidates


# -----------------------------
# Caption line extraction for a time range (used by drawtext fallback)
# -----------------------------

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

# -----------------------------
# FFmpeg clipping utilities
# -----------------------------


def save_clip(
    video_path: str | Path,
    output_path: str | Path,
    *,
    start: float,
    end: Optional[float] = None,
    duration: Optional[float] = None,
    reencode: bool = False,
    extra_ffmpeg_args: Optional[list[str]] = None,
) -> bool:
    """Save a single clip from `video_path` to `output_path`.

    If `reencode=False`, we try stream copy for speed (may be slightly off by keyframes).
    If `reencode=True`, we re-encode with H.264/AAC for frame-accurate cuts.
    """
    vp = Path(video_path)
    op = Path(output_path)
    op.parent.mkdir(parents=True, exist_ok=True)

    if not vp.exists():
        print(f"FFMPEG: source not found: {vp}")
        return False

    if (end is None) == (duration is None):
        raise ValueError("Provide exactly one of `end` or `duration`.")

    if end is None:
        end = max(0.0, start + float(duration))
    if end <= start:
        print("FFMPEG: invalid range (end <= start)")
        return False

    # Build ffmpeg command
    # Use -ss before -i for fast seek; for reencode we also put -ss after -i for accuracy.
    base = [
        "ffmpeg",
        "-y",
        "-ss", f"{start:.3f}",
        "-i", str(vp),
    ]

    if reencode:
        base += [
            "-to", f"{end:.3f}",
            "-c:v", "libx264",
            "-preset", "veryfast",
            "-crf", "18",
            "-c:a", "aac",
            "-movflags", "+faststart",
        ]
    else:
        # stream copy; some containers ignore -to unless after -i, but this works for mp4 typically
        base += [
            "-to", f"{end:.3f}",
            "-c", "copy",
            "-movflags", "+faststart",
        ]

    if extra_ffmpeg_args:
        base += list(extra_ffmpeg_args)

    base.append(str(op))

    t0 = time.time()
    try:
        proc = subprocess.run(base, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True)
        dt = time.time() - t0
        print(f"FFMPEG: wrote {op.name} in {dt:.2f}s")
        return True
    except subprocess.CalledProcessError as e:
        dt = time.time() - t0
        print(f"FFMPEG: failed in {dt:.2f}s -> {e}\nSTDERR:\n{e.stderr.decode(errors='ignore')[:500]}")
        return False



def save_clip_from_candidate(video_path: str | Path, output_dir: str | Path, candidate: ClipCandidate, *, reencode: bool = False) -> Path | None:
    """Convenience wrapper that names the clip using timestamps and rating."""
    out = Path(output_dir) / f"clip_{candidate.start:.2f}-{candidate.end:.2f}_r{candidate.rating:.1f}.mp4"
    ok = save_clip(video_path, out, start=candidate.start, end=candidate.end, reencode=reencode)
    return out if ok else None

# -----------------------------
# Vertical (9:16) render with burned subtitles
# -----------------------------

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

# -----------------------------
# Manual run configuration (no CLI)
# -----------------------------

if __name__ == "__main__":
    # Hardcoded configuration for manual runs
    TRANSCRIPT_PATH = "Andy_and_Nick_Do_the_Bird_Box_Challenge_-_KF_AF_20190109.txt"
    VIDEO_PATH = "Andy_and_Nick_Do_the_Bird_Box_Challenge_-_KF_AF_20190109.mp4"
    OUTPUT_DIR = "clips_out"
    MIN_RATING = 8.5
    MODEL = "gemma3:latest"
    REENCODE = False

    # Prefer batched extraction for long transcripts
    # candidates = find_funny_timestamps_batched(
    #     TRANSCRIPT_PATH,
    #     min_rating=MIN_RATING,
    #     model=MODEL,
    #     max_chars_per_chunk=12000,
    #     overlap_lines=4,
    #     request_timeout=180,
    # )
    # print(f"Found {len(candidates)} candidates >= {MIN_RATING}")
    # # Preview first 3
    # print(candidates[:3])

    # MANIFEST_PATH = Path(OUTPUT_DIR) / "candidates.json"
    # export_candidates_json(candidates, MANIFEST_PATH)
    # print(f"Wrote manifest -> {MANIFEST_PATH}")
    candidates = load_candidates_json("clips_out/candidates.json")

    Path(OUTPUT_DIR).mkdir(parents=True, exist_ok=True)
    total = len(candidates)
    for idx, candidate in enumerate(candidates):
        path = save_clip_from_candidate(VIDEO_PATH, OUTPUT_DIR, candidate, reencode=REENCODE)
        print(f"Saved: {path} ({idx+1}/{total})")

    # Vertical renders with captions from generated clips (expects filenames from save loop)
    for idx, candidate in enumerate(candidates):
        # Derived path of the previously saved horizontal clip
        horiz_name = f"clip_{candidate.start:.2f}-{candidate.end:.2f}_r{candidate.rating:.1f}.mp4"
        horiz_path = Path(OUTPUT_DIR) / horiz_name
        if not horiz_path.exists():
            print(f"VERTICAL: missing source {horiz_name}, skipping")
            continue
        vpath = render_vertical_from_candidate_moviepy(horiz_path, TRANSCRIPT_PATH, candidate, OUTPUT_DIR, font=None, font_size=56)
        print(f"Vertical saved: {vpath}")
