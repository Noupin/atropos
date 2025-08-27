from __future__ import annotations

from pathlib import Path

from server.helpers.formatting import sanitize_filename
from server.helpers.logging import run_step
from server.steps.download import get_video_info

from . import steps

BASE_OUTPUT_DIR = Path(__file__).resolve().parent.parent / "out"


def run_pipeline(yt_url: str, clip_type: str, min_rating: float) -> None:
    """Run the full clipping pipeline."""
    video_info = get_video_info(yt_url)
    if not video_info:
        raise ValueError("Failed to retrieve video information.")

    upload_date = video_info["upload_date"]
    title = sanitize_filename(video_info["title"])
    if len(upload_date) == 8:
        upload_date = f"{upload_date[:4]}{upload_date[4:6]}{upload_date[6:]}"
    else:
        upload_date = "Unknown_Date"
    non_suffix_filename = f"{title}_{upload_date}"

    project_dir = BASE_OUTPUT_DIR / non_suffix_filename
    project_dir.mkdir(parents=True, exist_ok=True)

    video_path = project_dir / f"{non_suffix_filename}.mp4"
    run_step(
        f"STEP 1: Downloading video -> {video_path}",
        steps.download_video,
        yt_url,
        video_path,
    )

    audio_path = project_dir / f"{non_suffix_filename}.mp3"
    audio_ok = run_step(
        f"STEP 2: Ensuring audio -> {audio_path}",
        steps.ensure_audio,
        yt_url,
        audio_path,
        video_path,
    )

    transcript_path = project_dir / f"{non_suffix_filename}.txt"
    run_step(
        f"STEP 3: Fetching transcript -> {transcript_path}",
        steps.get_transcript,
        yt_url,
        transcript_path,
        audio_ok,
        audio_path,
    )

    silences_path = project_dir / "silences.json"
    silences = run_step(
        f"STEP 4: Detecting silences -> {silences_path}",
        steps.detect_silences,
        audio_path,
        silences_path,
        audio_ok,
    )

    candidates = run_step(
        "STEP 5: Finding clip candidates", 
        steps.find_clip_candidates,
        transcript_path,
        clip_type,
        min_rating,
        project_dir,
    )

    run_step(
        "STEP 6: Processing candidates",
        steps.process_candidates,
        candidates,
        transcript_path,
        audio_path,
        video_path,
        silences,
        project_dir,
    )
