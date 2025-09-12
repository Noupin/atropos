"""Tests for the transcribe step."""

import sys
import types
from pathlib import Path


class FakeSegment:
    def __init__(self, start, end, text):
        self.start = start
        self.end = end
        self.text = text


class FakeModel:
    def __init__(self, *args, **kwargs):
        pass

    def transcribe(self, file_path):
        segments = (
            seg
            for seg in [
                FakeSegment(0.0, 1.0, "Hello "),
                FakeSegment(1.0, 2.0, "world!"),
            ]
        )
        return segments, {}


fake_fw = types.SimpleNamespace(WhisperModel=FakeModel)
sys.modules["faster_whisper"] = fake_fw
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "server"))
from server.steps import transcribe


def test_transcribe_audio_handles_generator():
    result = transcribe.transcribe_audio("dummy", model_size="fake")
    assert result["text"] == "Hello world!"
    assert result["segments"] == [
        {"start": 0.0, "end": 1.0, "text": "Hello "},
        {"start": 1.0, "end": 2.0, "text": "world!"},
    ]
    assert result["timing"]["total_time"] >= 0


def test_whisper_model_env_override(monkeypatch):
    monkeypatch.setenv("WHISPER_MODEL", "tiny-test")
    import importlib
    import config
    importlib.reload(config)
    assert config.WHISPER_MODEL == "tiny-test"


def test_write_transcript_normalizes_quotes(tmp_path):
    from server.helpers.transcript import write_transcript_txt

    result = {
        "segments": [
            {"start": 0.0, "end": 1.0, "text": "It\u2019s fine"},
        ],
        "timing": {},
    }
    out = tmp_path / "t.txt"
    write_transcript_txt(result, str(out))
    content = out.read_text(encoding="utf-8")
    assert "It's fine" in content
    assert "\u2019" not in content

