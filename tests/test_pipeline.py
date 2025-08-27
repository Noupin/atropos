from __future__ import annotations

from pathlib import Path
from unittest.mock import patch

import server.pipeline.main as pipeline_main
from server.pipeline import run_pipeline
from server.steps.candidates import ClipCandidate


def test_argument_parsing() -> None:
    parser = pipeline_main.create_parser()
    args = parser.parse_args(
        [
            "https://youtu.be/example",
            "--clip-type",
            "inspiring",
            "--min-rating",
            "8.5",
        ]
    )
    assert args.yt_url == "https://youtu.be/example"
    assert args.clip_type == "inspiring"
    assert args.min_rating == 8.5


def test_run_pipeline_dry_run(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr("server.pipeline.BASE_OUTPUT_DIR", tmp_path)

    with (
        patch(
            "server.pipeline.get_video_info",
            return_value={"title": "T", "upload_date": "20200101"},
        ),
        patch("server.pipeline.steps.download_video") as download_video,
        patch("server.pipeline.steps.ensure_audio", return_value=True) as ensure_audio,
        patch("server.pipeline.steps.get_transcript") as get_transcript,
        patch("server.pipeline.steps.detect_silences", return_value=[]) as detect_silences,
        patch(
            "server.pipeline.steps.find_clip_candidates",
            return_value=[ClipCandidate(0.0, 1.0, 9.0, "r", "q")],
        ) as find_candidates,
        patch("server.pipeline.steps.process_candidates") as process_candidates,
    ):
        run_pipeline("http://example.com", "funny", 7.0)

    download_video.assert_called_once()
    ensure_audio.assert_called_once()
    get_transcript.assert_called_once()
    detect_silences.assert_called_once()
    find_candidates.assert_called_once()
    process_candidates.assert_called_once()
