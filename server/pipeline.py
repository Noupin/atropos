from dotenv import load_dotenv
load_dotenv(dotenv_path="../.env")

import json
import config

from interfaces.progress import PipelineEvent, PipelineEventType, PipelineObserver
from steps.transcribe import transcribe_audio
from steps.download import (
    download_transcript,
    download_video,
    get_video_info,
    get_video_urls,
    is_twitch_url,
)
from steps.candidates.tone import find_candidates_by_tone, STRATEGY_REGISTRY
from custom_types.ETone import Tone
from steps.candidates.helpers import (
    export_candidates_json,
    load_candidates_json,
    parse_transcript,
    dedupe_candidates,
)
from steps.segment import (
    segment_transcript_items,
    maybe_refine_segments_with_llm,

    write_segments_json,
)
from steps.cut import save_clip_from_candidate
from steps.subtitle import build_srt_for_range
from steps.render import render_vertical_with_captions
from steps.render_layouts import get_layout
from steps.silence import (
    detect_silences,
    write_silences_json,
    snap_start_to_silence,
    snap_end_to_silence,
)
from steps.dialog import (
    detect_dialog_ranges,
    write_dialog_ranges_json,
    load_dialog_ranges_json,
)
from config import (
    CLIP_TYPE,
    EXPORT_RAW_CLIPS,
    RAW_LIMIT,
    SILENCE_DETECTION_NOISE,
    SILENCE_DETECTION_MIN_DURATION,
    TRANSCRIPT_SOURCE,
    WHISPER_MODEL,
    FORCE_REBUILD,
    FORCE_REBUILD_SEGMENTS,
    FORCE_REBUILD_DIALOG,
    USE_LLM_FOR_SEGMENTS,
    CLEANUP_NON_SHORTS,
    START_AT_STEP,
    RENDER_LAYOUT,
)

import sys
import time
import re
from pathlib import Path

from helpers.audio import ensure_audio
from helpers.transcript import write_transcript_txt
from helpers.transcript_quality import score_transcript_quality
from helpers.formatting import (
    Fore,
    Style,
    sanitize_filename,
    youtube_timestamp_url,
)
from helpers.logging import run_step
from helpers.notifications import send_failure_email
from helpers.description import maybe_append_website_link
from steps.candidates import ClipCandidate
from helpers.cleanup import cleanup_project_dir
from common.caption_utils import prepare_hashtags
from helpers.hashtags import generate_hashtag_strings


GENERIC_HASHTAGS = ["foryou", "fyp", "viral", "trending"]


def process_video(
    yt_url: str,
    account: str | None = None,
    tone: Tone | None = None,
    observer: PipelineObserver | None = None,
) -> None:
    """Run the clipping pipeline for ``yt_url``.

    Parameters
    ----------
    yt_url:
        YouTube or Twitch URL to process.
    account:
        Optional account name to namespace outputs under ``out/<account>``.
    tone:
        Optional tone override. When omitted, :data:`config.CLIP_TYPE` is used.
    """

    overall_start = time.perf_counter()
    ansi_escape = re.compile(r"\x1b\[[0-9;]*m")

    def emit_log(message: str, level: str = "info") -> None:
        print(message)
        if observer:
            observer.handle_event(
                PipelineEvent(
                    type=PipelineEventType.LOG,
                    message=ansi_escape.sub("", message),
                    data={"level": level},
                )
            )

    if observer:
        observer.handle_event(
            PipelineEvent(
                type=PipelineEventType.PIPELINE_STARTED,
                message="Pipeline started",
                data={
                    "url": yt_url,
                    "account": account,
                    "tone": tone.value if tone else None,
                },
            )
        )

    twitch = is_twitch_url(yt_url)
    transcript_source = "whisper" if twitch else TRANSCRIPT_SOURCE

    def should_run(step: int) -> bool:
        return START_AT_STEP <= step

    video_info = get_video_info(yt_url)

    if not video_info:
        message = f"{Fore.RED}Failed to retrieve video information.{Style.RESET_ALL}"
        emit_log(message, level="error")
        if observer:
            observer.handle_event(
                PipelineEvent(
                    type=PipelineEventType.PIPELINE_COMPLETED,
                    message="Pipeline failed",
                    data={
                        "success": False,
                        "error": "Failed to retrieve video information",
                    },
                )
            )
        return

    upload_date = video_info["upload_date"]
    sanitized_title = sanitize_filename(video_info["title"])
    if len(upload_date) == 8:
        upload_date = upload_date[:4] + upload_date[4:6] + upload_date[6:]
    else:
        upload_date = "Unknown_Date"
    non_suffix_filename = f"{sanitized_title}_{upload_date}"
    emit_log(f"File Name: {non_suffix_filename}")

    # Create a dedicated output directory for this run
    base_output_dir = Path(__file__).resolve().parent.parent / "out"
    if account:
        base_output_dir /= account
    project_dir = base_output_dir / non_suffix_filename
    project_dir.mkdir(parents=True, exist_ok=True)

    # ----------------------
    # STEP 1: Download Video
    # ----------------------
    video_output_path = project_dir / f"{non_suffix_filename}.mp4"

    def step_download() -> None:
        if video_output_path.exists() and video_output_path.stat().st_size > 0:
            emit_log(
                f"{Fore.GREEN}STEP 1: Video already present -> {video_output_path}{Style.RESET_ALL}"
            )
        else:
            download_video(yt_url, str(video_output_path))

    if should_run(1):
        run_step(
            f"STEP 1: Downloading video -> {video_output_path}",
            step_download,
            step_id="step_1_download",
            observer=observer,
        )
    else:
        emit_log(
            f"{Fore.YELLOW}Skipping STEP 1: assuming video exists at {video_output_path}{Style.RESET_ALL}",
            level="warning",
        )

    # ----------------------
    # STEP 2: Acquire Audio
    # ----------------------
    audio_output_path = project_dir / f"{non_suffix_filename}.mp3"

    def step_audio() -> bool:
        return ensure_audio(yt_url, str(audio_output_path), str(video_output_path))

    if should_run(2):
        audio_ok = run_step(
            f"STEP 2: Ensuring audio -> {audio_output_path}",
            step_audio,
            step_id="step_2_audio",
            observer=observer,
        )
        if not audio_ok:
            emit_log(
                f"{Fore.YELLOW}STEP 2: Failed to acquire audio (direct + video-extract fallbacks tried).{Style.RESET_ALL}",
                level="warning",
            )
            send_failure_email(
                "Audio acquisition failed",
                f"Failed to acquire audio for video {yt_url}",
            )
    else:
        audio_ok = audio_output_path.exists()
        emit_log(
            f"{Fore.YELLOW}Skipping STEP 2: assuming audio exists at {audio_output_path}{Style.RESET_ALL}",
            level="warning",
        )

    # ----------------------
    # STEP 3: Get Text (Transcript or Transcription)
    # ----------------------
    transcript_output_path = project_dir / f"{non_suffix_filename}.txt"

    def step_download_transcript() -> bool:
        return download_transcript(
            yt_url,
            str(transcript_output_path),
            languages=["en", "en-US", "en-GB"],
        )

    def step_transcribe() -> bool:
        result = transcribe_audio(
            str(audio_output_path), model_size=WHISPER_MODEL
        )
        write_transcript_txt(result, str(transcript_output_path))
        return True

    if should_run(3):
        if transcript_source == "whisper":
            yt_ok = False
            transcribed = False
            if audio_ok:
                transcribed = run_step(
                    f"STEP 3: Transcribing with faster-whisper ({WHISPER_MODEL})",
                    step_transcribe,
                    step_id="step_3_transcribe",
                    observer=observer,
                )
                if transcribed:
                    emit_log(
                        f"{Fore.GREEN}STEP 3: Transcription saved -> {transcript_output_path}{Style.RESET_ALL}"
                    )
            if not transcribed:
                yt_ok = run_step(
                    f"STEP 3: Attempting YouTube transcript -> {transcript_output_path}",
                    step_download_transcript,
                    step_id="step_3_download_transcript",
                    observer=observer,
                )
            if yt_ok:
                text = transcript_output_path.read_text(encoding="utf-8")
                quality = score_transcript_quality(text)
                emit_log(f"STEP 3: YouTube transcript quality {quality:.2f}")
                if quality < 0.60 and audio_ok:
                    emit_log(
                        "STEP 3: Quality below threshold, transcribing with Whisper",
                        level="warning",
                    )
                    run_step(
                        f"STEP 3: Transcribing with faster-whisper ({WHISPER_MODEL})",
                        step_transcribe,
                        step_id="step_3_transcribe_retry",
                        observer=observer,
                    )
                    emit_log(
                        f"{Fore.GREEN}STEP 3: Transcription saved -> {transcript_output_path}{Style.RESET_ALL}"
                    )
                else:
                    emit_log(
                        f"{Fore.GREEN}STEP 3: Used YouTube transcript.{Style.RESET_ALL}"
                    )
            elif not transcribed:
                emit_log(
                    f"{Fore.RED}STEP 3: Cannot transcribe because audio acquisition failed.{Style.RESET_ALL}",
                    level="error",
                )
                send_failure_email(
                    "Transcript unavailable",
                    f"No transcript could be retrieved or generated for video {yt_url} because audio acquisition failed.",
                )
        else:
            yt_ok = run_step(
                f"STEP 3: Attempting YouTube transcript -> {transcript_output_path}",
                step_download_transcript,
                step_id="step_3_download_transcript",
                observer=observer,
            )
            if yt_ok:
                text = transcript_output_path.read_text(encoding="utf-8")
                quality = score_transcript_quality(text)
                emit_log(f"STEP 3: YouTube transcript quality {quality:.2f}")
                if quality < 0.60 and audio_ok:
                    emit_log(
                        "STEP 3: Quality below threshold, transcribing with Whisper",
                        level="warning",
                    )
                    run_step(
                        f"STEP 3: Transcribing with faster-whisper ({WHISPER_MODEL})",
                        step_transcribe,
                        step_id="step_3_transcribe",
                        observer=observer,
                    )
                    emit_log(
                        f"{Fore.GREEN}STEP 3: Transcription saved -> {transcript_output_path}{Style.RESET_ALL}"
                    )
                else:
                    emit_log(
                        f"{Fore.GREEN}STEP 3: Used YouTube transcript.{Style.RESET_ALL}"
                    )
            else:
                if not audio_ok:
                    emit_log(
                        f"{Fore.RED}STEP 3: Cannot transcribe because audio acquisition failed.{Style.RESET_ALL}",
                        level="error",
                    )
                    send_failure_email(
                        "Transcript unavailable",
                        f"No transcript could be retrieved or generated for video {yt_url} because audio acquisition failed.",
                    )
                else:
                    run_step(
                        f"STEP 3: Transcribing with faster-whisper ({WHISPER_MODEL})",
                        step_transcribe,
                        step_id="step_3_transcribe",
                        observer=observer,
                    )
                    emit_log(
                        f"{Fore.GREEN}STEP 3: Transcription saved -> {transcript_output_path}{Style.RESET_ALL}"
                    )
    else:
        emit_log(
            f"{Fore.YELLOW}Skipping STEP 3: assuming transcript exists at {transcript_output_path}{Style.RESET_ALL}",
            level="warning",
        )

    # ----------------------
    # STEP 4: Detect Silence Segments
    # ----------------------
    silences_path = project_dir / "silences.json"

    def step_silences() -> list[tuple[float, float]]:
        silences = (
            detect_silences(
                str(audio_output_path),
                noise=SILENCE_DETECTION_NOISE,
                min_duration=SILENCE_DETECTION_MIN_DURATION,
            )
            if audio_ok
            else []
        )
        write_silences_json(silences, silences_path)
        return silences

    if should_run(4):
        silences = run_step(
            f"STEP 4: Detecting silences -> {silences_path}",
            step_silences,
            step_id="step_4_silences",
            observer=observer,
        )
    else:
        if silences_path.exists():
            data = json.loads(silences_path.read_text(encoding="utf-8"))
            silences = [tuple(d.values()) for d in data]
            emit_log(
                f"{Fore.YELLOW}Skipping STEP 4: loaded {len(silences)} silences from {silences_path}{Style.RESET_ALL}",
                level="warning",
            )
        else:
            silences = []
            emit_log(
                f"{Fore.YELLOW}Skipping STEP 4: no existing silences at {silences_path}{Style.RESET_ALL}",
                level="warning",
            )
    emit_log(f"[Pipeline] Detected {len(silences)} silences")

    # ----------------------
    # STEP 5: Build Transcript Structure
    # ----------------------
    segments_path = project_dir / "segments.json"

    if should_run(5):
        if segments_path.exists() and not (FORCE_REBUILD or FORCE_REBUILD_SEGMENTS):
            segments_data = json.loads(segments_path.read_text(encoding="utf-8"))
            segments = [(d["start"], d["end"], d["text"]) for d in segments_data]
        else:
            def step_segments() -> list[tuple[float, float, str]]:
                items = parse_transcript(transcript_output_path)
                segs = segment_transcript_items(items)
                text = transcript_output_path.read_text(encoding="utf-8")
                if USE_LLM_FOR_SEGMENTS:
                    segs = maybe_refine_segments_with_llm(segs)
                write_segments_json(segs, segments_path)
                return segs

            segments = run_step(
                f"STEP 5: Segmenting transcript -> {segments_path}",
                step_segments,
                step_id="step_5_segments",
                observer=observer,
            )
    else:
        if segments_path.exists():
            segments_data = json.loads(segments_path.read_text(encoding="utf-8"))
            segments = [(d["start"], d["end"], d["text"]) for d in segments_data]
            emit_log(
                f"{Fore.YELLOW}Skipping STEP 5: loaded segments from {segments_path}{Style.RESET_ALL}",
                level="warning",
            )
        else:
            segments = []
            emit_log(
                f"{Fore.YELLOW}Skipping STEP 5: no existing segments at {segments_path}{Style.RESET_ALL}",
                level="warning",
            )
    emit_log(f"[Pipeline] Loaded {len(segments)} segments")

    dialog_ranges_path = project_dir / "dialog_ranges.json"
    if should_run(5):
        if dialog_ranges_path.exists() and not (FORCE_REBUILD or FORCE_REBUILD_DIALOG):
            dialog_ranges = load_dialog_ranges_json(dialog_ranges_path)
        else:
            def step_dialog_ranges() -> list[tuple[float, float]]:
                emit_log(
                    f"[Pipeline] Starting dialog detection using transcript: {transcript_output_path}"
                )
                ranges = detect_dialog_ranges(transcript_output_path)
                write_dialog_ranges_json(ranges, dialog_ranges_path)
                return ranges

            dialog_ranges = run_step(
                f"STEP 5: Detecting dialog ranges -> {dialog_ranges_path}",
                step_dialog_ranges,
                step_id="step_5_dialog_ranges",
                observer=observer,
            )
    else:
        if dialog_ranges_path.exists():
            dialog_ranges = load_dialog_ranges_json(dialog_ranges_path)
            emit_log(
                f"{Fore.YELLOW}Skipping STEP 5: loaded dialog ranges from {dialog_ranges_path}{Style.RESET_ALL}",
                level="warning",
            )
        else:
            dialog_ranges = []
            emit_log(
                f"{Fore.YELLOW}Skipping STEP 5: no existing dialog ranges at {dialog_ranges_path}{Style.RESET_ALL}",
                level="warning",
            )
    emit_log(f"[Pipeline] Loaded {len(dialog_ranges)} dialog ranges")

    # ----------------------
    # STEP 6: Find Clip Candidates
    # ----------------------
    candidates_path = project_dir / "candidates.json"
    candidates_all_path = project_dir / "candidates_all.json"
    candidates_top_path = project_dir / "candidates_top.json"
    render_queue_path = project_dir / "render_queue.json"

    clips_dir = project_dir / "clips"
    raw_clips_dir = project_dir / "clips_raw"
    subtitles_dir = project_dir / "subtitles"
    shorts_dir = project_dir / "shorts"

    clips_dir.mkdir(parents=True, exist_ok=True)
    if EXPORT_RAW_CLIPS:
        raw_clips_dir.mkdir(parents=True, exist_ok=True)
    subtitles_dir.mkdir(parents=True, exist_ok=True)
    shorts_dir.mkdir(parents=True, exist_ok=True)

    selected_tone = tone or CLIP_TYPE
    if selected_tone is None:
        raise ValueError(f"Unsupported clip type: {CLIP_TYPE}")
    strategy = STRATEGY_REGISTRY[selected_tone]

    refined_candidates: list[ClipCandidate] = []

    if should_run(6):
        def step_candidates() -> tuple[list[ClipCandidate], list[ClipCandidate], list[ClipCandidate]]:
            return find_candidates_by_tone(
                str(transcript_output_path),
                tone=selected_tone,
                return_all_stages=True,
                segments=segments,
                dialog_ranges=dialog_ranges,
                silences=silences,
            )

        if (
            candidates_path.exists()
            and candidates_all_path.exists()
            and candidates_top_path.exists()
            and not FORCE_REBUILD
        ):
            candidates = load_candidates_json(candidates_path)
            top_candidates = load_candidates_json(candidates_top_path)
            all_candidates = load_candidates_json(candidates_all_path)
        else:
            result = run_step(
                "STEP 6: Finding clip candidates from transcript",
                step_candidates,
                step_id="step_6_candidates",
                observer=observer,
            )
            if result is None:
                candidates = top_candidates = all_candidates = []
            else:
                candidates, top_candidates, all_candidates = result
                export_candidates_json(all_candidates, candidates_all_path)
                export_candidates_json(top_candidates, candidates_top_path)
                export_candidates_json(candidates, candidates_path)
        emit_log(
            f"[Pipeline] Candidates: {len(candidates)} final, {len(top_candidates)} top, {len(all_candidates)} total"
        )

        if not candidates:
            emit_log(
                f"{Fore.RED}STEP 6: No clip candidates found.{Style.RESET_ALL}",
                level="error",
            )
            send_failure_email(
                "No clip candidates found",
                f"No clip candidates were found for video {yt_url}",
            )
            # sys.exit()

        if EXPORT_RAW_CLIPS:
            # Silence-only clips
            raw_candidates = [
                ClipCandidate(
                    start=
                    snap_start_to_silence(c.start, silences) if strategy.snap_to_silence else c.start,
                    end=snap_end_to_silence(c.end, silences) if strategy.snap_to_silence else c.end,
                    rating=c.rating,
                    reason=c.reason,
                    quote=c.quote,
                )
                for c in candidates
            ]
            raw_candidates = dedupe_candidates(raw_candidates)[:RAW_LIMIT]
            emit_log(f"[Pipeline] Exporting {len(raw_candidates)} raw candidates")

            for idx, cand in enumerate(raw_candidates, start=1):
                def step_cut_raw() -> Path | None:
                    return save_clip_from_candidate(
                        video_output_path, raw_clips_dir, cand
                    )

                run_step(
                    f"STEP 6R.{idx}: Cutting raw clip -> {raw_clips_dir}",
                    step_cut_raw,
                    step_id=f"step_6_raw_cut_{idx}",
                    observer=observer,
                )

        refined_candidates = dedupe_candidates(candidates)
        export_candidates_json(refined_candidates, render_queue_path)
    else:
        if candidates_path.exists():
            refined_candidates = load_candidates_json(candidates_path)
        else:
            refined_candidates = []
            for clip_file in sorted(clips_dir.glob("clip_*.mp4")):
                match = re.search(r"clip_(\d+\.\d+)-(\d+\.\d+)_", clip_file.name)
                if match:
                    refined_candidates.append(
                        ClipCandidate(
                            start=float(match.group(1)),
                            end=float(match.group(2)),
                            rating=0.0,
                            reason="",
                            quote=None,
                        )
                    )
        emit_log(
            f"{Fore.YELLOW}Skipping STEP 6: using {len(refined_candidates)} existing candidates{Style.RESET_ALL}",
            level="warning",
        )
        export_candidates_json(refined_candidates, render_queue_path)

    for idx, candidate in enumerate(refined_candidates, start=1):
        def step_cut() -> Path | None:
            return save_clip_from_candidate(video_output_path, clips_dir, candidate)

        if should_run(6):
            clip_path = run_step(
                f"STEP 6.{idx}: Cutting clip -> {clips_dir}",
                step_cut,
                step_id=f"step_6_cut_{idx}",
                observer=observer,
            )
            if clip_path is None:
                emit_log(
                    f"{Fore.RED}STEP 6.{idx}: Failed to cut clip.{Style.RESET_ALL}",
                    level="error",
                )
                send_failure_email(
                    "Clip cutting failed",
                    f"Failed to cut clip {idx} for video {yt_url}",
                )
                continue
        else:
            clip_path = clips_dir / (
                f"clip_{candidate.start:.2f}-{candidate.end:.2f}_r{candidate.rating:.1f}.mp4"
            )
            if not clip_path.exists():
                emit_log(
                    f"{Fore.RED}STEP 6.{idx}: Expected clip not found -> {clip_path}{Style.RESET_ALL}",
                    level="error",
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

        if should_run(7):
            run_step(
                f"STEP 7.{idx}: Generating subtitles -> {srt_path}",
                step_subtitles,
                step_id=f"step_7_subtitles_{idx}",
                observer=observer,
            )
        else:
            emit_log(
                f"{Fore.YELLOW}Skipping STEP 7.{idx}: assuming subtitles exist at {srt_path}{Style.RESET_ALL}",
                level="warning",
            )

        vertical_output = shorts_dir / f"{clip_path.stem}.mp4"

        def step_render() -> Path:
            return render_vertical_with_captions(
                clip_path,
                srt_path,
                vertical_output,
                layout=get_layout(RENDER_LAYOUT),
            )

        if should_run(8):
            run_step(
                f"STEP 8.{idx}: Rendering vertical video with captions -> {vertical_output}",
                step_render,
                step_id=f"step_8_render_{idx}",
                observer=observer,
            )
        else:
            emit_log(
                f"{Fore.YELLOW}Skipping STEP 8.{idx}: assuming video exists at {vertical_output}{Style.RESET_ALL}",
                level="warning",
            )

        description_path = shorts_dir / f"{clip_path.stem}.txt"

        def step_description() -> Path:
            tags = generate_hashtag_strings(
                title=video_info["title"],
                quote=candidate.quote,
                show=video_info.get("uploader"),
            )
            if not tags:
                send_failure_email(
                    "Hashtag generation failed",
                    f"No hashtags generated for clip {idx} of video {yt_url}",
                )
            fallback_words: list[str] = []
            if not tags:
                fallback_words = [
                    w
                    for w in video_info["title"].split()
                    if re.sub(r"[^0-9A-Za-z]", "", w)
                ][:3]
            hashtags = prepare_hashtags(
                tags + fallback_words + GENERIC_HASHTAGS,
                video_info.get("uploader"),
            )
            hashtags.extend(["#shorts", "#withatropos"])
            full_video_link = youtube_timestamp_url(yt_url, candidate.start)
            description = (
                f"Full video: {full_video_link}\n\n"
                f"Credit: {video_info.get('uploader', 'Unknown Channel')}\n"
                "Made by Atropos\n"
            )
            description = maybe_append_website_link(description)
            description += "\nIf you know any more creators who don't do clips, leave them in the comments below!\n"
            description += "\n" + " ".join(hashtags)
            description_path.write_text(description, encoding="utf-8")
            return description_path

        if should_run(9):
            run_step(
                f"STEP 9.{idx}: Writing description -> {description_path}",
                step_description,
                step_id=f"step_9_description_{idx}",
                observer=observer,
            )
        else:
            emit_log(
                f"{Fore.YELLOW}Skipping STEP 9.{idx}: assuming description exists at {description_path}{Style.RESET_ALL}",
                level="warning",
            )

    total_elapsed = time.perf_counter() - overall_start
    emit_log(
        f"{Fore.MAGENTA}Full pipeline completed in {total_elapsed:.2f}s{Style.RESET_ALL}"
    )
    if CLEANUP_NON_SHORTS:
        cleanup_project_dir(project_dir)

    if observer:
        observer.handle_event(
            PipelineEvent(
                type=PipelineEventType.PIPELINE_COMPLETED,
                message="Pipeline completed",
                data={
                    "success": True,
                    "elapsed_seconds": total_elapsed,
                    "project_dir": str(project_dir),
                    "clips_processed": len(refined_candidates),
                },
            )
        )


if __name__ == "__main__":
    # tone = Tone.SCIENCE
    # account = "cosmos"
    # # Melodysheep: Water Worlds
    # # yt_url = "https://www.youtube.com/watch?v=URyiCGZNjdI"
    # # StarTalk
    # # yt_url = ""
    # # SEA
    # yt_url = "https://www.youtube.com/watch?v=Fe6vJU0IV2E"


    # tone = Tone.FUNNY 
    # account = "funnykinda"
    # # In Review Playlist (newest first)
    # # yt_url = "https://www.youtube.com/playlist?list=PLy3mMHt2i7RKE9ba8rfL7_qnFcpbUaA8_"
    # # KFAF Playlist(newest first)
    # # start next one at [11:]
    # # yt_url = "https://www.youtube.com/playlist?list=PLOlEpGVXWUVurPHlIotFyz-cIOXjV_cxx"
    # # Last Of Us
    # # start next one at [2:]
    # yt_url = "https://www.youtube.com/playlist?list=PLBIL5prmXqedEXXikBxPsvKRREB-DaoWb"


    tone = Tone.HEALTH
    account = "health"
    # Matt Lane: Can I Get Fit On Fast Food?
    # yt_url = "https://www.youtube.com/watch?v=6J6FI8PAy5E"
    # Matt Lane: Ask MLFit Show
    # start next one at [25:]
    yt_url = "https://www.youtube.com/playlist?list=PLfw1VEbkByghq-SR-HCj0NNTLzRpTVinI"


    # tone = Tone.HISTORY
    # account = "history"
    # # Crash Course World History
    # # yt_url = "https://www.youtube.com/playlist?list=PLBDA2E52FB1EF80C9"
    # # World History Battles
    # # start next one at [18:]
    # yt_url = "https://www.youtube.com/playlist?list=PL_gGGlaAre787Q8Wx6sCF5m9podjPcqfx"


    # tone = Tone.CONSPIRACY
    # account = "secrets"
    # # Bright Insight: Lost Civilizations
    # # start next one at [10:]
    # yt_url = "https://www.youtube.com/playlist?list=PL8PPtxxTQjQu7fznaPSkk-WosHgPs5y4Z"


    urls = get_video_urls(yt_url)
    # urls.reverse() # If the playlist is newest first, reverse to process oldest first
    for url in urls[12:25]:
        process_video(url, account=account, tone=tone)