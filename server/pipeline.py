from steps.transcribe import transcribe_audio
from steps.download import download_transcript, download_video, get_video_info
from steps.candidates.funny import find_funny_timestamps_batched
from steps.candidates.inspiring import find_inspiring_timestamps_batched
from steps.candidates.educational import find_educational_timestamps_batched
from steps.candidates.helpers import (
    export_candidates_json,
    load_candidates_json,
    parse_transcript,
    _snap_start_to_segment_start,
    _snap_end_to_segment_end,
)
from steps.cut import save_clip_from_candidate
from steps.subtitle import build_srt_for_range
from steps.render import render_vertical_with_captions
from steps.silence import (
    detect_silences,
    write_silences_json,
    snap_start_to_silence,
    snap_end_to_silence,
)

import sys
import time
from pathlib import Path

from helpers.audio import ensure_audio
from helpers.transcript import write_transcript_txt
from helpers.formatting import Fore, Style, sanitize_filename
from helpers.logging import run_step
from steps.candidates import ClipCandidate


if __name__ == "__main__":
    overall_start = time.perf_counter()

    # yt_url = "https://www.youtube.com/watch?v=GDbDRWzFfds" #KFAF 1
    # yt_url = "https://www.youtube.com/watch?v=zZYxqZFThls" #KFAF 2
    yt_url = "https://www.youtube.com/watch?v=K9aFbYd6AUI" #Superman
    # yt_url = "https://www.youtube.com/watch?v=os2AyD_4RjM" #Dark phoenix
    # yt_url = input("Enter YouTube video URL: ")

    CLIP_TYPE = "funny"  # change to 'inspiring' or 'educational'
    MIN_RATING = 7.0

    video_info = get_video_info(yt_url)

    if not video_info:
        print(f"{Fore.RED}Failed to retrieve video information.{Style.RESET_ALL}")
        sys.exit()

    upload_date = video_info["upload_date"]
    sanitized_title = sanitize_filename(video_info["title"])
    if len(upload_date) == 8:
        upload_date = upload_date[:4] + upload_date[4:6] + upload_date[6:]
    else:
        upload_date = "Unknown_Date"
    non_suffix_filename = f"{sanitized_title}_{upload_date}"
    print(f"File Name: {non_suffix_filename}")

    # Create a dedicated output directory for this run
    base_output_dir = Path(__file__).resolve().parent.parent / "out"
    project_dir = base_output_dir / non_suffix_filename
    project_dir.mkdir(parents=True, exist_ok=True)

    # ----------------------
    # STEP 1: Download Video
    # ----------------------
    video_output_path = project_dir / f"{non_suffix_filename}.mp4"

    def step_download() -> None:
        if video_output_path.exists() and video_output_path.stat().st_size > 0:
            print(
                f"{Fore.GREEN}STEP 1: Video already present -> {video_output_path}{Style.RESET_ALL}"
            )
        else:
            download_video(yt_url, str(video_output_path))

    run_step(f"STEP 1: Downloading video -> {video_output_path}", step_download)

    # ----------------------
    # STEP 2: Acquire Audio
    # ----------------------
    audio_output_path = project_dir / f"{non_suffix_filename}.mp3"

    def step_audio() -> bool:
        return ensure_audio(yt_url, str(audio_output_path), str(video_output_path))

    audio_ok = run_step(f"STEP 2: Ensuring audio -> {audio_output_path}", step_audio)
    if not audio_ok:
        print(
            f"{Fore.YELLOW}STEP 2: Failed to acquire audio (direct + video-extract fallbacks tried).{Style.RESET_ALL}"
        )

    # ----------------------
    # STEP 3: Get Text (Transcript or Transcription)
    # ----------------------
    transcript_output_path = project_dir / f"{non_suffix_filename}.txt"

    def step_download_transcript() -> bool:
        return download_transcript(
            yt_url,
            str(transcript_output_path),
            languages=["en", "en-US", "en-GB", "ko"],
        )

    yt_ok = run_step(
        f"STEP 3: Attempting YouTube transcript -> {transcript_output_path}",
        step_download_transcript,
    )
    if yt_ok:
        print(f"{Fore.GREEN}STEP 3: Used YouTube transcript.{Style.RESET_ALL}")
    else:
        if not audio_ok:
            print(
                f"{Fore.RED}STEP 3: Cannot transcribe because audio acquisition failed.{Style.RESET_ALL}"
            )
        else:

            def step_transcribe() -> None:
                result = transcribe_audio(
                    str(audio_output_path), model_size="large-v3-turbo"
                )
                write_transcript_txt(result, str(transcript_output_path))

            run_step(
                "STEP 3: Transcribing with faster-whisper (large-v3-turbo)",
                step_transcribe,
            )
            print(
                f"{Fore.GREEN}STEP 3: Transcription saved -> {transcript_output_path}{Style.RESET_ALL}"
            )

    # ----------------------
    # STEP 4: Detect Silence Segments
    # ----------------------
    silences_path = project_dir / "silences.json"

    def step_silences() -> list[tuple[float, float]]:
        silences = detect_silences(str(audio_output_path)) if audio_ok else []
        write_silences_json(silences, silences_path)
        return silences

    silences = run_step(
        f"STEP 4: Detecting silences -> {silences_path}", step_silences
    )

    # ----------------------
    # STEP 5: Find Clip Candidates
    # ----------------------
    candidates_path = project_dir / "candidates.json"

    CLIP_FINDERS = {
        "funny": find_funny_timestamps_batched,
        "inspiring": find_inspiring_timestamps_batched,
        "educational": find_educational_timestamps_batched,
    }

    def step_candidates() -> list[ClipCandidate]:
        finder = CLIP_FINDERS.get(CLIP_TYPE)
        if finder is None:
            raise ValueError(f"Unsupported clip type: {CLIP_TYPE}")
        return finder(str(transcript_output_path), min_rating=MIN_RATING)

    candidates = run_step(
        "STEP 5: Finding clip candidates from transcript", step_candidates
    )
    if not candidates:
        print(f"{Fore.RED}STEP 5: No clip candidates found.{Style.RESET_ALL}")
        sys.exit()

    export_candidates_json(candidates, candidates_path)
    # candidates = load_candidates_json('../out/Andy_and_Nick_Do_the_Bird_Box_Challenge_-_KF_AF_20190109/candidates.json')

    # Parse transcript once for snapping boundaries
    items = parse_transcript(transcript_output_path)

    clips_dir = project_dir / "clips"
    subtitles_dir = project_dir / "subtitles"
    shorts_dir = project_dir / "shorts"

    clips_dir.mkdir(parents=True, exist_ok=True)
    subtitles_dir.mkdir(parents=True, exist_ok=True)
    shorts_dir.mkdir(parents=True, exist_ok=True)

    for idx, cand in enumerate(candidates, start=1):
        snapped_start = _snap_start_to_segment_start(cand.start, items)
        snapped_end = _snap_end_to_segment_end(cand.end, items)
        adj_start = snap_start_to_silence(snapped_start, silences)
        adj_end = snap_end_to_silence(snapped_end, silences)
        candidate = ClipCandidate(
            start=adj_start,
            end=adj_end,
            rating=cand.rating,
            reason=cand.reason,
            quote=cand.quote,
        )

        def step_cut() -> Path | None:
            return save_clip_from_candidate(video_output_path, clips_dir, candidate)

        clip_path = run_step(
            f"STEP 6.{idx}: Cutting clip -> {clips_dir}", step_cut
        )
        if clip_path is None:
            print(
                f"{Fore.RED}STEP 6.{idx}: Failed to cut clip.{Style.RESET_ALL}"
            )
            continue

        srt_path = subtitles_dir / f"{clip_path.stem}.srt"

        def step_subtitles() -> Path:
            return build_srt_for_range(
                transcript_output_path,
                global_start=candidate.start,
                global_end=candidate.end,
                srt_path=srt_path,
            )

        run_step(
            f"STEP 7.{idx}: Generating subtitles -> {srt_path}", step_subtitles
        )

        vertical_output = shorts_dir / f"{clip_path.stem}_vertical.mp4"

        def step_render() -> Path:
            return render_vertical_with_captions(
                clip_path,
                srt_path,
                vertical_output,
            )

        run_step(
            f"STEP 8.{idx}: Rendering vertical video with captions -> {vertical_output}",
            step_render,
        )

    total_elapsed = time.perf_counter() - overall_start
    print(
        f"{Fore.MAGENTA}Full pipeline completed in {total_elapsed:.2f}s{Style.RESET_ALL}"
    )
