"""Tests for ensuring audio acquisition logic."""

from pathlib import Path
from typing import List

import pytest

from server.helpers import audio


def test_ensure_audio_uses_fallback(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Should extract from existing video if download fails."""
    audio_path = tmp_path / "a.mp3"
    video_path = tmp_path / "v.mp4"
    video_path.write_bytes(b"video")

    def fail_download(url: str, out: str) -> None:  # pragma: no cover - mock
        raise RuntimeError("fail")

    called: List[str] = []

    def succeed_extract(src: str, dst: str) -> None:  # pragma: no cover - mock
        called.append("extract")
        Path(dst).write_bytes(b"audio")

    monkeypatch.setattr(audio, "download_audio", fail_download)
    monkeypatch.setattr(audio, "extract_audio_from_video", succeed_extract)

    ok = audio.ensure_audio("u", str(audio_path), str(video_path))

    assert ok is True
    assert audio_path.read_bytes() == b"audio"
    assert called == ["extract"]


def test_ensure_audio_failure_without_video(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Should return ``False`` if download fails and no video path is provided."""
    audio_path = tmp_path / "a.mp3"

    def fail_download(url: str, out: str) -> None:  # pragma: no cover - mock
        raise RuntimeError("fail")

    monkeypatch.setattr(audio, "download_audio", fail_download)

    ok = audio.ensure_audio("u", str(audio_path))

    assert ok is False
