from __future__ import annotations

from server.steps import download as dl


class DummyAPI:
    """Minimal stand‑in for :class:`YouTubeTranscriptApi`."""

    def fetch(self, video_id: str, languages: tuple[str, ...] | None = None):
        return [{"start": 0.0, "duration": 1.0, "text": "Hello"}]


def test_download_transcript_returns_data_and_writes_file(tmp_path, monkeypatch):
    """``download_transcript`` should return transcript data and optionally write
    a formatted file."""

    monkeypatch.setattr(dl, "YouTubeTranscriptApi", lambda: DummyAPI())

    out_file = tmp_path / "t.txt"
    transcript = dl.download_transcript("dummy_url", output_path=str(out_file))

    assert transcript == [{"start": 0.0, "duration": 1.0, "text": "Hello"}]
    assert out_file.read_text(encoding="utf-8") == "[0.00 -> 1.00] Hello\n"
