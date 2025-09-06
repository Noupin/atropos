from dotenv import load_dotenv
load_dotenv(dotenv_path="../.env")

import json

from steps.transcribe import transcribe_audio
from steps.download import (
    download_transcript,
    download_video,
    get_video_info,
    get_video_urls,
    is_twitch_url,
)
from steps.candidates.funny import find_funny_timestamps_batched
from steps.candidates.inspiring import find_inspiring_timestamps_batched
from steps.candidates.educational import find_educational_timestamps_batched
from steps.candidates.helpers import (
    export_candidates_json,
    load_candidates_json,
    parse_transcript,
    _snap_start_to_sentence_start,
    _snap_end_to_sentence_end,
    snap_start_to_dialog_start,
    snap_end_to_dialog_end,
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
    FUNNY_MIN_RATING,
    INSPIRING_MIN_RATING,
    EDUCATIONAL_MIN_RATING,
    DEFAULT_MIN_RATING,
    SNAP_TO_SILENCE,
    SNAP_TO_DIALOG,
    SNAP_TO_SENTENCE,
    EXPORT_RAW_CLIPS,
    RAW_LIMIT,
    SILENCE_DETECTION_NOISE,
    SILENCE_DETECTION_MIN_DURATION,
    TRANSCRIPT_SOURCE,
    WHISPER_MODEL,
    MIN_DURATION_SECONDS,
    MAX_DURATION_SECONDS,
    FORCE_REBUILD,
    FORCE_REBUILD_SEGMENTS,
    FORCE_REBUILD_DIALOG,
    MIN_EXTENSION_MARGIN,
    USE_LLM_FOR_SEGMENTS,
    SEG_LLM_MAX_CHARS,
    CLEANUP_NON_SHORTS,
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
from helpers.ai import local_llm_call_json
from helpers.description import maybe_append_website_link
from steps.candidates import ClipCandidate
from helpers.cleanup import cleanup_project_dir




def process_video(yt_url: str, niche: str | None = None) -> None:
    overall_start = time.perf_counter()
    twitch = is_twitch_url(yt_url)
    transcript_source = "whisper" if twitch else TRANSCRIPT_SOURCE

    CLIP_TYPE = "funny"  # change to 'inspiring' or 'educational'
    rating_defaults = {
        "funny": FUNNY_MIN_RATING,
        "inspiring": INSPIRING_MIN_RATING,
        "educational": EDUCATIONAL_MIN_RATING,
    }
    MIN_RATING = rating_defaults.get(CLIP_TYPE, DEFAULT_MIN_RATING)

    video_info = get_video_info(yt_url)

    if not video_info:
        send_failure_email(
            "Video info retrieval failed",
            f"Failed to retrieve video information for {yt_url}",
        )
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
    if niche:
        base_output_dir /= niche
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
        send_failure_email(
            "Audio acquisition failed",
            f"Failed to acquire audio for video {yt_url}",
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

    if transcript_source == "whisper":
        yt_ok = False
        transcribed = False
        if audio_ok:
            transcribed = run_step(
                f"STEP 3: Transcribing with faster-whisper ({WHISPER_MODEL})",
                step_transcribe,
            )
            if transcribed:
                print(
                    f"{Fore.GREEN}STEP 3: Transcription saved -> {transcript_output_path}{Style.RESET_ALL}"
                )
        if not transcribed:
            yt_ok = run_step(
                f"STEP 3: Attempting YouTube transcript -> {transcript_output_path}",
                step_download_transcript,
            )
        if yt_ok:
            text = transcript_output_path.read_text(encoding="utf-8")
            quality = score_transcript_quality(text)
            print(
                f"STEP 3: YouTube transcript quality {quality:.2f}"
            )
            if quality < 0.60 and audio_ok:
                print("STEP 3: Quality below threshold, transcribing with Whisper")
                run_step(
                    f"STEP 3: Transcribing with faster-whisper ({WHISPER_MODEL})",
                    step_transcribe,
                )
                print(
                    f"{Fore.GREEN}STEP 3: Transcription saved -> {transcript_output_path}{Style.RESET_ALL}"
                )
            else:
                print(
                    f"{Fore.GREEN}STEP 3: Used YouTube transcript.{Style.RESET_ALL}"
                )
        elif not transcribed:
            print(
                f"{Fore.RED}STEP 3: Cannot transcribe because audio acquisition failed.{Style.RESET_ALL}"
            )
            send_failure_email(
                "Transcript unavailable",
                f"No transcript could be retrieved or generated for video {yt_url} because audio acquisition failed.",
            )
    else:
        yt_ok = run_step(
            f"STEP 3: Attempting YouTube transcript -> {transcript_output_path}",
            step_download_transcript,
        )
        if yt_ok:
            text = transcript_output_path.read_text(encoding="utf-8")
            quality = score_transcript_quality(text)
            print(f"STEP 3: YouTube transcript quality {quality:.2f}")
            if quality < 0.60 and audio_ok:
                print("STEP 3: Quality below threshold, transcribing with Whisper")
                run_step(
                    f"STEP 3: Transcribing with faster-whisper ({WHISPER_MODEL})",
                    step_transcribe,
                )
                print(
                    f"{Fore.GREEN}STEP 3: Transcription saved -> {transcript_output_path}{Style.RESET_ALL}"
                )
            else:
                print(f"{Fore.GREEN}STEP 3: Used YouTube transcript.{Style.RESET_ALL}")
        else:
            if not audio_ok:
                print(
                    f"{Fore.RED}STEP 3: Cannot transcribe because audio acquisition failed.{Style.RESET_ALL}"
                )
                send_failure_email(
                    "Transcript unavailable",
                    f"No transcript could be retrieved or generated for video {yt_url} because audio acquisition failed.",
                )
            else:
                run_step(
                    f"STEP 3: Transcribing with faster-whisper ({WHISPER_MODEL})",
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

    silences = run_step(
        f"STEP 4: Detecting silences -> {silences_path}", step_silences
    )
    print(f"[Pipeline] Detected {len(silences)} silences")

    # ----------------------
    # STEP 5: Build Transcript Structure
    # ----------------------
    segments_path = project_dir / "segments.json"

    if segments_path.exists() and not (FORCE_REBUILD or FORCE_REBUILD_SEGMENTS):
        segments_data = json.loads(segments_path.read_text(encoding="utf-8"))
        segments = [(d["start"], d["end"], d["text"]) for d in segments_data]
    else:
        def step_segments() -> list[tuple[float, float, str]]:
            items = parse_transcript(transcript_output_path)
            segs = segment_transcript_items(items)
            text = transcript_output_path.read_text(encoding="utf-8")
            if USE_LLM_FOR_SEGMENTS and len(text) < SEG_LLM_MAX_CHARS:
                segs = maybe_refine_segments_with_llm(segs)
            write_segments_json(segs, segments_path)
            return segs

        segments = run_step(
            f"STEP 5: Segmenting transcript -> {segments_path}", step_segments
        )
    print(f"[Pipeline] Loaded {len(segments)} segments")

    dialog_ranges_path = project_dir / "dialog_ranges.json"
    if dialog_ranges_path.exists() and not (FORCE_REBUILD or FORCE_REBUILD_DIALOG):
        dialog_ranges = load_dialog_ranges_json(dialog_ranges_path)
    else:
        def step_dialog_ranges() -> list[tuple[float, float]]:
            print(
                f"[Pipeline] Starting dialog detection using transcript: {transcript_output_path}"
            )
            ranges = detect_dialog_ranges(transcript_output_path)
            write_dialog_ranges_json(ranges, dialog_ranges_path)
            return ranges

        dialog_ranges = run_step(
            f"STEP 5: Detecting dialog ranges -> {dialog_ranges_path}",
            step_dialog_ranges,
        )
    print(f"[Pipeline] Loaded {len(dialog_ranges)} dialog ranges")

    # ----------------------
    # STEP 6: Find Clip Candidates
    # ----------------------
    candidates_path = project_dir / "candidates.json"
    candidates_all_path = project_dir / "candidates_all.json"
    candidates_top_path = project_dir / "candidates_top.json"

    CLIP_FINDERS = {
        "funny": find_funny_timestamps_batched,
        "inspiring": find_inspiring_timestamps_batched,
        "educational": find_educational_timestamps_batched,
    }

    def step_candidates() -> tuple[list[ClipCandidate], list[ClipCandidate], list[ClipCandidate]]:
        finder = CLIP_FINDERS.get(CLIP_TYPE)
        if finder is None:
            raise ValueError(f"Unsupported clip type: {CLIP_TYPE}")
        return finder(
            str(transcript_output_path),
            min_rating=MIN_RATING,
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
        candidates, top_candidates, all_candidates = run_step(
            "STEP 6: Finding clip candidates from transcript", step_candidates
        )
        export_candidates_json(all_candidates, candidates_all_path)
        export_candidates_json(top_candidates, candidates_top_path)
        export_candidates_json(candidates, candidates_path)
    print(
        f"[Pipeline] Candidates: {len(candidates)} final, {len(top_candidates)} top, {len(all_candidates)} total"
    )

    if not candidates:
        print(f"{Fore.RED}STEP 6: No clip candidates found.{Style.RESET_ALL}")
        send_failure_email(
            "No clip candidates found",
            f"No clip candidates were found for video {yt_url}",
        )
        sys.exit()

    clips_dir = project_dir / "clips"
    raw_clips_dir = project_dir / "clips_raw"
    subtitles_dir = project_dir / "subtitles"
    shorts_dir = project_dir / "shorts"

    clips_dir.mkdir(parents=True, exist_ok=True)
    if EXPORT_RAW_CLIPS:
        raw_clips_dir.mkdir(parents=True, exist_ok=True)
    subtitles_dir.mkdir(parents=True, exist_ok=True)
    shorts_dir.mkdir(parents=True, exist_ok=True)

    if EXPORT_RAW_CLIPS:
        # Silence-only clips
        raw_candidates = [
            ClipCandidate(
                start=
                snap_start_to_silence(c.start, silences) if SNAP_TO_SILENCE else c.start,
                end=snap_end_to_silence(c.end, silences) if SNAP_TO_SILENCE else c.end,
                rating=c.rating,
                reason=c.reason,
                quote=c.quote,
            )
            for c in candidates
        ]
        raw_candidates = dedupe_candidates(raw_candidates)[:RAW_LIMIT]
        print(f"[Pipeline] Exporting {len(raw_candidates)} raw candidates")

        for idx, cand in enumerate(raw_candidates, start=1):
            def step_cut_raw() -> Path | None:
                return save_clip_from_candidate(
                    video_output_path, raw_clips_dir, cand
                )

            run_step(
                f"STEP 6R.{idx}: Cutting raw clip -> {raw_clips_dir}",
                step_cut_raw,
            )

    # Fully snapped clips
    refined_candidates = []
    for cand in candidates:
        start = cand.start
        end = cand.end
        if SNAP_TO_DIALOG:
            start = snap_start_to_dialog_start(start, dialog_ranges)
        if SNAP_TO_SENTENCE:
            start = _snap_start_to_sentence_start(start, segments)
        if SNAP_TO_SILENCE:
            start = snap_start_to_silence(start, silences)

        if SNAP_TO_SENTENCE:
            end = _snap_end_to_sentence_end(end, segments)
        if SNAP_TO_DIALOG:
            end = snap_end_to_dialog_end(end, dialog_ranges)
        if SNAP_TO_SILENCE:
            end = snap_end_to_silence(end, silences)

        dur = end - start
        if dur < MIN_DURATION_SECONDS:
            target = start + MIN_DURATION_SECONDS + MIN_EXTENSION_MARGIN
            if SNAP_TO_SENTENCE:
                for _, seg_end, _ in segments:
                    if seg_end >= target:
                        end = seg_end
                        break
                else:
                    end = start + MIN_DURATION_SECONDS
            else:
                end = start + MIN_DURATION_SECONDS
        elif dur > MAX_DURATION_SECONDS:
            end = start + MAX_DURATION_SECONDS

        refined_candidates.append(
            ClipCandidate(
                start=start,
                end=end,
                rating=cand.rating,
                reason=cand.reason,
                quote=cand.quote,
            )
        )

    refined_candidates = dedupe_candidates(refined_candidates)

    for idx, candidate in enumerate(refined_candidates, start=1):
        def step_cut() -> Path | None:
            return save_clip_from_candidate(video_output_path, clips_dir, candidate)

        clip_path = run_step(
            f"STEP 6.{idx}: Cutting clip -> {clips_dir}", step_cut
        )
        if clip_path is None:
            print(
                f"{Fore.RED}STEP 6.{idx}: Failed to cut clip.{Style.RESET_ALL}"
            )
            send_failure_email(
                "Clip cutting failed",
                f"Failed to cut clip {idx} for video {yt_url}",
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

        vertical_output = shorts_dir / f"{clip_path.stem}.mp4"

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

        description_path = shorts_dir / f"{clip_path.stem}.txt"

        def step_description() -> Path:
            prompt = (
                "Generate as many relevant hashtags for a short form video based on the "
                "video's title"
            )
            if candidate.quote:
                prompt += " and a quote from the clip"
            prompt += (
                ". Respond with a JSON array of strings without the # symbol.\n"
                f"Title: {video_info['title']}\n"
            )
            if candidate.quote:
                prompt += f"Quote: {candidate.quote}"
            try:
                tags = local_llm_call_json(
                    model="google/gemma-3-4b",
                    prompt=prompt,
                    options={"temperature": 0.0},
                )
            except Exception as e:
                print(f"[Hashtags] error generating hashtags: {e}")
                send_failure_email(
                    "Hashtag generation failed",
                    f"Error generating hashtags for clip {idx} of video {yt_url}: {e}",
                )
                tags = []
            if not tags:
                send_failure_email(
                    "Hashtag generation failed",
                    f"No hashtags generated for clip {idx} of video {yt_url}",
                )
            hashtags = [
                "#" + tag.replace(" ", "")
                for tag in tags
                if isinstance(tag, str)
            ]
            if not hashtags:
                fallback = [
                    "#" + re.sub(r"\W+", "", w.lower())
                    for w in video_info["title"].split()
                    if re.sub(r"\W+", "", w)
                ][:3]
                hashtags.extend(fallback)
            hashtags.extend(["#shorts", "#madebyatropos"])
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

        run_step(
            f"STEP 9.{idx}: Writing description -> {description_path}",
            step_description,
        )

    total_elapsed = time.perf_counter() - overall_start
    print(
        f"{Fore.MAGENTA}Full pipeline completed in {total_elapsed:.2f}s{Style.RESET_ALL}"
    )
    if CLEANUP_NON_SHORTS:
        cleanup_project_dir(project_dir)


if __name__ == "__main__":
    # yt_url = "https://www.youtube.com/watch?v=GDbDRWzFfds" #KFAF 1
    # yt_url = "https://www.youtube.com/watch?v=zZYxqZFThls"  # KFAF 2
    # yt_url = "https://www.youtube.com/playlist?list=PLOlEpGVXWUVvLGotSXrDeZetca0jayby1" #DCEU(newest first)
    # yt_url = "https://www.youtube.com/watch?v=os2AyD_4RjM" #Dark phoenix
    # yt_url = "https://www.youtube.com/watch?v=JM1KbE-C9XE" #KFAF Nicks 40th birthday
    yt_url = "https://www.youtube.com/playlist?list=PLOlEpGVXWUVurPHlIotFyz-cIOXjV_cxx"  # KFAF Playlist(newest first)
    # yt_url = "https://www.youtube.com/playlist?list=PLlZTdvF5WOdwtw4pEsrxuP-5wfzgsUJY-" # AVP in review playlist(newest first order)
    # yt_url = "https://www.youtube.com/playlist?list=PL8F86WtVt7aboLYsBkbau1fxQrhAmBoxK" # MCU In review
    # yt_url = "https://www.youtube.com/playlist?list=PLOlEpGVXWUVtQQqX1nezpnsbeok2U6K8h" # star wars (newest first)
    # yt_url = input("Enter YouTube video URL: ")

    urls = get_video_urls(yt_url)
    urls.reverse() # If the playlist is newest first, reverse to process oldest first
    niche = "funny"  # Set to a niche/account name to output under out/<niche>
    for url in urls[5:6]:
        process_video(url, niche=niche)
