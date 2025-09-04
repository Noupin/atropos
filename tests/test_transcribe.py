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

