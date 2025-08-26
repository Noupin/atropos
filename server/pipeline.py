from steps.transcribe import transcribe_audio
from steps.download import download_transcript, download_video, get_video_info
from steps.candidates import find_funny_timestamps_batched, export_candidates_json, load_candidates_json
from steps.cut import save_clip_from_candidate
from steps.candidates import (
    parse_transcript,
    _snap_start_to_segment_start,
    _snap_end_to_segment_end,
)
from steps.subtitle import build_srt_for_range
# Step 7 rendering now uses MoviePy instead of ffmpeg
from steps.render import render_vertical_with_captions_moviepy

import sys
from pathlib import Path

from helpers.audio import ensure_audio
from helpers.transcript import write_transcript_txt
from helpers.formatting import Fore, Style, sanitize_filename
from helpers.logging import run_step
from interfaces.clip_candidate import ClipCandidate


if __name__ == "__main__":
    yt_url = 'https://www.youtube.com/watch?v=GDbDRWzFfds'
    # yt_url = input("Enter YouTube video URL: ")
    video_info = get_video_info(yt_url)

    if not video_info:
        print(f"{Fore.RED}Failed to retrieve video information.{Style.RESET_ALL}")
        sys.exit()

    upload_date = video_info['upload_date']
    sanitized_title = sanitize_filename(video_info['title'])
    if len(upload_date) == 8:
        upload_date = upload_date[:4] + upload_date[4:6] + upload_date[6:]
    else:
        upload_date = 'Unknown_Date'
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
    # audio_output_path = project_dir / f"{non_suffix_filename}.mp3"

    # def step_audio() -> bool:
    #     return ensure_audio(yt_url, str(audio_output_path), str(video_output_path))

    # audio_ok = run_step(
    #     f"STEP 2: Ensuring audio -> {audio_output_path}", step_audio
    # )
    # if not audio_ok:
    #     print(
    #         f"{Fore.YELLOW}STEP 2: Failed to acquire audio (direct + video-extract fallbacks tried).{Style.RESET_ALL}"
    #     )

    # # ----------------------
    # # STEP 3: Get Text (Transcript or Transcription)
    # # ----------------------
    transcript_output_path = project_dir / f"{non_suffix_filename}.txt"

    # def step_download_transcript() -> bool:
    #     return download_transcript(
    #         yt_url, str(transcript_output_path), languages=["en", "en-US", "en-GB", "ko"]
    #     )

    # yt_ok = run_step(
    #     f"STEP 3: Attempting YouTube transcript -> {transcript_output_path}",
    #     step_download_transcript,
    # )
    # if yt_ok:
    #     print(f"{Fore.GREEN}STEP 3: Used YouTube transcript.{Style.RESET_ALL}")
    # else:
    #     if not audio_ok:
    #         print(
    #             f"{Fore.RED}STEP 3: Cannot transcribe because audio acquisition failed.{Style.RESET_ALL}"
    #         )
    #     else:
    #         def step_transcribe() -> None:
    #             result = transcribe_audio(
    #                 str(audio_output_path), model_size="large-v3-turbo"
    #             )
    #             write_transcript_txt(result, str(transcript_output_path))

    #         run_step(
    #             "STEP 3: Transcribing with faster-whisper (large-v3-turbo)",
    #             step_transcribe,
    #         )
    #         print(
    #             f"{Fore.GREEN}STEP 3: Transcription saved -> {transcript_output_path}{Style.RESET_ALL}"
    #         )

    # # ----------------------
    # # STEP 4: Find Clip Candidates
    # # ----------------------
    # candidates_path = project_dir / "candidates.json"

    # def step_candidates() -> list[ClipCandidate]:
    #     return find_funny_timestamps_batched(str(transcript_output_path))

    # candidates = run_step(
    #     "STEP 4: Finding clip candidates from transcript", step_candidates
    # )
    # if not candidates:
    #     print(f"{Fore.RED}STEP 4: No clip candidates found.{Style.RESET_ALL}")
    #     sys.exit()

    # export_candidates_json(candidates, candidates_path)
    candidates = load_candidates_json('../out/Andy_and_Nick_Do_the_Bird_Box_Challenge_-_KF_AF_20190109/candidates.json')

    best_candidate = max(candidates, key=lambda c: c.rating)
    items = parse_transcript(transcript_output_path)
    snapped_start = _snap_start_to_segment_start(best_candidate.start, items)
    snapped_end = _snap_end_to_segment_end(best_candidate.end, items)
    print(
        f"Selected clip {snapped_start:.2f}-{snapped_end:.2f} (rating {best_candidate.rating:.1f})"
    )
    best_candidate = ClipCandidate(
        start=snapped_start,
        end=snapped_end,
        rating=best_candidate.rating,
        reason=best_candidate.reason,
        quote=best_candidate.quote,
    )

    # ----------------------
    # STEP 5: Cut Clip
    # ----------------------
    clips_dir = project_dir / "clips"

    def step_cut() -> Path | None:
        return save_clip_from_candidate(
            video_output_path, clips_dir, best_candidate
        )

    clip_path = run_step(
        f"STEP 5: Cutting clip -> {clips_dir}", step_cut
    )
    if clip_path is None:
        print(f"{Fore.RED}STEP 5: Failed to cut clip.{Style.RESET_ALL}")
        sys.exit()

    # ----------------------
    # STEP 6: Build Subtitles
    # ----------------------
    subtitles_dir = project_dir / "subtitles"
    srt_path = subtitles_dir / f"{clip_path.stem}.srt"

    def step_subtitles() -> Path:
        return build_srt_for_range(
            transcript_output_path,
            global_start=best_candidate.start,
            global_end=best_candidate.end,
            srt_path=srt_path,
        )

    run_step(
        f"STEP 6: Generating subtitles -> {srt_path}", step_subtitles
    )

    # ----------------------
    # STEP 7: Render Vertical Video with Captions
    # ----------------------
    shorts_dir = project_dir / "shorts"
    vertical_output = shorts_dir / f"{clip_path.stem}_vertical.mp4"

    def step_render() -> bool:
        return render_vertical_with_captions_moviepy(
            clip_path,
            transcript_output_path,
            global_start=best_candidate.start,
            global_end=best_candidate.end,
            output_path=vertical_output,
        )

    run_step(
        f"STEP 7: Rendering vertical video -> {vertical_output}", step_render
    )
