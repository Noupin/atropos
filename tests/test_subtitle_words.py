import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "server"))

from server.steps.subtitle import build_srt_for_range


def test_build_srt_writes_word_timings(tmp_path: Path) -> None:
    transcript = tmp_path / "sample.txt"
    transcript.write_text("[0.00 -> 2.00] Hello world\n", encoding="utf-8")
    words_payload = {
        "segments": [
            {
                "start": 0.0,
                "end": 2.0,
                "text": "Hello world",
                "words": [
                    {"start": 0.0, "end": 0.8, "text": "Hello"},
                    {"start": 0.9, "end": 1.8, "text": "world"},
                ],
            }
        ],
        "timing": {},
    }
    transcript.with_suffix(".json").write_text(
        json.dumps(words_payload, ensure_ascii=False), encoding="utf-8"
    )

    srt_path = tmp_path / "clip.srt"
    build_srt_for_range(
        transcript,
        global_start=0.0,
        global_end=2.0,
        srt_path=srt_path,
    )

    words_path = srt_path.with_suffix(".words.json")
    assert words_path.exists()
    data = json.loads(words_path.read_text(encoding="utf-8"))
    assert data["words"] == [
        {"start": 0.0, "end": 0.8, "text": "Hello"},
        {"start": 0.9, "end": 1.8, "text": "world"},
    ]
