from __future__ import annotations

import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from server.steps.captions import (
    _parse_srt_text,
    _load_captions_from_path,
)


def test_parse_srt_text_valid() -> None:
    srt = (
        "1\n00:00:00,000 --> 00:00:01,000\nHello\n\n"
        "2\n00:00:01,000 --> 00:00:02,000\nWorld\n"
    )
    assert _parse_srt_text(srt) == [(0.0, 1.0, "Hello"), (1.0, 2.0, "World")]


def test_load_captions_json_valid(tmp_path: Path) -> None:
    data = [{"start": 0, "end": 1, "text": "Hi"}, {"start": 1, "end": 2, "text": "There"}]
    p = tmp_path / "caps.json"
    p.write_text(json.dumps(data), encoding="utf-8")
    assert _load_captions_from_path(p) == [(0.0, 1.0, "Hi"), (1.0, 2.0, "There")]


def test_load_captions_failure(tmp_path: Path) -> None:
    bad_json = tmp_path / "bad.json"
    bad_json.write_text("{not json}")
    assert _load_captions_from_path(bad_json) == []

    bad_srt = tmp_path / "bad.srt"
    bad_srt.write_text("no timestamps here")
    assert _load_captions_from_path(bad_srt) == []

