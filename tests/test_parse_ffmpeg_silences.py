"""Tests for parsing ffmpeg silencedetect logs."""

from server.steps.candidates.silence import parse_ffmpeg_silences


def test_parse_ffmpeg_silences_multiple() -> None:
    """Should parse multiple silence intervals from sample log text."""
    log = (
        "[silencedetect] silence_start: 0.5\n"
        "[silencedetect] silence_end: 1.0 | silence_duration: 0.5\n"
        "[silencedetect] silence_start: 2.0\n"
        "[silencedetect] silence_end: 3.5 | silence_duration: 1.5\n"
    )
    assert parse_ffmpeg_silences(log) == [(0.5, 1.0), (2.0, 3.5)]
