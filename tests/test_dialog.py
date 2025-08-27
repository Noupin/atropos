from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
import sys
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "server"))

from server.steps.dialog import (
    detect_dialog_ranges,
    write_dialog_ranges_json,
    load_dialog_ranges_json,
)


def _make_transcript(path: Path) -> None:
    path.write_text(
        """
[0.0 -> 1.0] Hello.
[1.0 -> 2.0] This is funny haha!
[2.1 -> 3.0] Are you serious?
[4.0 -> 5.0] Another statement.
""".strip()
    )


def test_detect_dialog_ranges(tmp_path: Path) -> None:
    transcript = tmp_path / "sample.txt"
    _make_transcript(transcript)
    ranges = detect_dialog_ranges(str(transcript))
    assert ranges == [(1.0, 3.0)]


def test_json_export_and_load(tmp_path: Path) -> None:
    transcript = tmp_path / "sample.txt"
    _make_transcript(transcript)
    ranges = detect_dialog_ranges(str(transcript))
    out = tmp_path / "dialog_ranges.json"
    write_dialog_ranges_json(ranges, out)
    loaded = load_dialog_ranges_json(out)
    assert loaded == ranges
