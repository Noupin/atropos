from __future__ import annotations

import json
import re
from pathlib import Path
from typing import List, Tuple, Optional, Union

_SRT_TIME = re.compile(
    r"^(\d{2}):(\d{2}):(\d{2}),(\d{3})\s+-->\s+(\d{2}):(\d{2}):(\d{2}),(\d{3})$"
)


def _hmsms_to_sec(h: str, m: str, s: str, ms: str) -> float:
    return int(h) * 3600 + int(m) * 60 + int(s) + int(ms) / 1000.0


def _parse_srt_text(s: str) -> List[Tuple[float, float, str]]:
    """Parse an SRT subtitle string into a list of timed text entries."""
    chunks = re.split(r"\r?\n\r?\n+", s.strip())
    out: List[Tuple[float, float, str]] = []
    for ch in chunks:
        lines = [ln for ln in ch.splitlines() if ln.strip() != ""]
        if not lines:
            continue
        idx = 0
        if lines and lines[0].strip().isdigit():
            idx = 1
        if idx >= len(lines):
            continue
        m = _SRT_TIME.match(lines[idx].strip())
        if not m:
            continue
        sh, sm, ss, sms, eh, em, es, ems = m.groups()
        start = _hmsms_to_sec(sh, sm, ss, sms)
        end = _hmsms_to_sec(eh, em, es, ems)
        text = " ".join(ln.strip() for ln in lines[idx + 1 :]).strip()
        if end > start and text:
            out.append((start, end, text))
    return out


def _load_captions_from_path(p: Path) -> List[Tuple[float, float, str]]:
    """Load captions from a file path supporting SRT or JSON formats."""
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
    return []


def _normalize_caps(
    caps: Optional[Union[List[Tuple[float, float, str]], List[dict], str, Path]]
) -> List[Tuple[float, float, str]]:
    """Normalize various caption representations into a sorted list."""
    if caps is None:
        return []
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

