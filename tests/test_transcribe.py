"""Tests for the transcribe step."""

import shutil
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
from server.helpers import audio as audio_helpers


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


def test_transcription_consistent_for_url_and_upload(monkeypatch, tmp_path):
    sample_audio = tmp_path / "sample.txt"
    sample_audio.write_text("cozy audio sample", encoding="utf-8")

    remote_audio_out = tmp_path / "remote.wav"
    local_audio_out = tmp_path / "local.wav"
    local_video = tmp_path / "video.mp4"
    local_video.write_text("video-bytes", encoding="utf-8")

    call_counts = {"download": 0, "extract": 0, "convert": 0}

    def fake_download(url: str, output_path: str, progress_callback=None):
        call_counts["download"] += 1
        shutil.copyfile(sample_audio, output_path)

    def fake_extract(video_path: str, audio_output_path: str):
        call_counts["extract"] += 1
        shutil.copyfile(sample_audio, audio_output_path)

    def fake_convert(source_path: str, target_path: str):
        call_counts["convert"] += 1
        shutil.copyfile(source_path, target_path)

    monkeypatch.setattr(audio_helpers, "download_audio", fake_download)
    monkeypatch.setattr(audio_helpers, "extract_audio_from_video", fake_extract)
    monkeypatch.setattr(audio_helpers, "_convert_to_pcm", fake_convert)

    def fake_transcribe(path: str, model_size="fake", progress_callback=None):
        return {"text": Path(path).read_text(encoding="utf-8"), "segments": [], "timing": {}}

    monkeypatch.setattr(transcribe, "transcribe_audio", fake_transcribe)

    assert audio_helpers.ensure_audio(
        "https://example.com/video",
        str(remote_audio_out),
        str(local_video),
    )
    assert audio_helpers.ensure_audio(
        None,
        str(local_audio_out),
        str(local_video),
    )

    remote_result = transcribe.transcribe_audio(str(remote_audio_out))
    local_result = transcribe.transcribe_audio(str(local_audio_out))

    expected_text = sample_audio.read_text(encoding="utf-8")
    assert remote_result["text"] == expected_text
    assert local_result["text"] == expected_text
    assert call_counts == {"download": 1, "extract": 1, "convert": 1}

