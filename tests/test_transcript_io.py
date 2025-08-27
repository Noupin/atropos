"""Tests for transcript writer."""

from pathlib import Path

from server.helpers.transcript import write_transcript_txt


def test_write_transcript(tmp_path: Path) -> None:
    """Segments and timing should be written in a readable format."""
    out = tmp_path / "t.txt"
    result = {
        "segments": [
            {"start": 0.0, "end": 1.0, "text": "Hello\nworld"},
            {"start": 1.5, "end": 2.0, "text": "Bye"},
        ],
        "timing": {"start_time": 0.0, "stop_time": 2.0, "total_time": 2.0},
    }
    write_transcript_txt(result, str(out))

    content = out.read_text(encoding="utf-8")
    assert content == (
        "[0.00 -> 1.00] Hello world\n"
        "[1.50 -> 2.00] Bye\n"
        "\n# TIMING\n"
        "start_time: 0.00 seconds\n"
        "stop_time: 2.00 seconds\n"
        "total_time: 2.00 seconds\n"
    )
