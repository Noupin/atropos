from __future__ import annotations

import json
from pathlib import Path
import sys

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from server.steps.segment import segment_transcript_items, write_segments_json


def test_segment_transcript_items_and_json(tmp_path: Path) -> None:
    items = [(0.0, 10.0, "Hello world. This is test.")]
    segments = segment_transcript_items(items)
    assert len(segments) == 2
    first_len = len("Hello world.")
    second_len = len("This is test.")
    expected_first_end = 10.0 * first_len / (first_len + second_len)
    assert segments[0][2] == "Hello world."
    assert segments[1][2] == "This is test."
    assert segments[0][0] == 0.0
    assert segments[0][1] == pytest.approx(expected_first_end)
    assert segments[1][0] == pytest.approx(expected_first_end)
    assert segments[1][1] == pytest.approx(10.0)

    out = tmp_path / "segments.json"
    write_segments_json(segments, out)
    assert out.exists()
    data = json.loads(out.read_text(encoding="utf-8"))
    assert data[0]["text"] == "Hello world."
    assert data[1]["text"] == "This is test."
