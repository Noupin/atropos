from __future__ import annotations

from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "server"))

from server.steps.candidates import find_clip_timestamps_batched
from server.steps.candidates.helpers import has_spoken_words, parse_transcript


def test_has_spoken_words_filters_music_line(tmp_path: Path) -> None:
    transcript = """
[0.00 -> 5.00] [music]
[5.00 -> 10.00] hello there
""".strip()
    p = tmp_path / "tx.txt"
    p.write_text(transcript, encoding="utf-8")
    items = parse_transcript(p)
    assert not has_spoken_words(0.0, 4.0, items)
    assert has_spoken_words(5.0, 6.0, items)


def test_batched_skip_music_only(tmp_path: Path, monkeypatch) -> None:
    transcript = """
[0.00 -> 5.00] [music]
[5.00 -> 10.00] hello there
""".strip()
    p = tmp_path / "tx.txt"
    p.write_text(transcript, encoding="utf-8")

    def fake_call_json(**kwargs):
        prompt = kwargs.get("prompt", "")
        if "TRANSCRIPT" in prompt:
            return [
                {"start": 0.0, "end": 4.0, "rating": 8.0, "reason": "", "quote": ""},
                {"start": 5.0, "end": 6.0, "rating": 8.0, "reason": "", "quote": "hi"},
            ]
        return [{"match": True}]

    monkeypatch.setattr(
        "server.steps.candidates.ollama_call_json", fake_call_json
    )

    cands = find_clip_timestamps_batched(p)
    assert len(cands) == 1
    assert cands[0].quote == "hi"
