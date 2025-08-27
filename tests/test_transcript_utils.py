from __future__ import annotations

from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from server.steps.candidates.transcript import parse_transcript


def test_parse_transcript(tmp_path: Path) -> None:
    txt = tmp_path / "t.txt"
    txt.write_text(
        "[0.00 -> 1.00] Hello\n[1.00 -> 2.50] world!\ninvalid\n",
        encoding="utf-8",
    )
    items = parse_transcript(txt)
    assert items == [(0.0, 1.0, "Hello"), (1.0, 2.5, "world!")]
