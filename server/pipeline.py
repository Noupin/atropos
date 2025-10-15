from dotenv import load_dotenv
load_dotenv(dotenv_path="../.env")

import json
import math
from dataclasses import dataclass
from typing import Any, Callable, Literal, TypeVar

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
import shutil
from datetime import datetime, timezone
from pathlib import Path

from helpers.audio import ensure_audio
from helpers.media import probe_media_duration
from helpers.transcript import write_transcript_txt
from helpers.transcript_quality import score_transcript_quality
from helpers.formatting import (
    Fore,
    Style,
    sanitize_filename,
    youtube_timestamp_url,
)
from helpers.logging import run_step, report_step_progress
from helpers.notifications import send_failure_email
from helpers.description import maybe_append_website_link
from steps.candidates import ClipCandidate
from helpers.cleanup import cleanup_project_dir
from common.caption_utils import prepare_hashtags
from helpers.hashtags import generate_hashtag_strings


GENERIC_HASHTAGS = ["foryou", "fyp", "viral", "trending"]


TStepResult = TypeVar("TStepResult")


@dataclass(frozen=True)
class PipelineSource:
    """Describe the origin of a pipeline run."""

    kind: Literal["url", "upload"]
    url: str | None = None
    path: Path | None = None
    filename: str | None = None

    @classmethod
    def from_url(cls, url: str) -> "PipelineSource":
        return cls(kind="url", url=url)

    @classmethod
    def from_upload(cls, path: Path, filename: str | None = None) -> "PipelineSource":
        return cls(kind="upload", path=path, filename=filename)

    @property
    def display_name(self) -> str:
        if self.kind == "url" and self.url:
            return self.url
        if self.filename:
            return self.filename
        if self.path:
            return str(self.path)
        return "uploaded video"

    def event_payload(self) -> dict[str, str | None]:
        return {
            "kind": self.kind,
            "url": self.url,
            "filename": self.filename or (self.path.name if self.path else None),
        }


def process_video(
    source_input: str | PipelineSource,
    account: str | None = None,
    tone: Tone | None = None,
    observer: PipelineObserver | None = None,
    *,
    pause_for_review: bool = False,
    review_gate: Callable[[], None] | None = None,
) -> None:
    """Run the clipping pipeline for a remote URL or uploaded file.

    Parameters
    ----------
    source_input:
        Either a supported video URL or a :class:`PipelineSource` describing an uploaded file.
    account:
        Optional account name to namespace outputs under ``out/<account>``.
    tone:
        Optional tone override. When omitted, :data:`config.CLIP_TYPE` is used.
    """

    if isinstance(source_input, PipelineSource):
        source = source_input
    else:
        source = PipelineSource.from_url(source_input)

    overall_start = time.perf_counter()
    ansi_escape = re.compile(r"\x1b\[[0-9;]*m")
    step_timers: dict[str, float] = {}
    source_label = source.display_name
    source_url = source.url

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

    def build_eta_extra(status: Any) -> dict[str, Any] | None:
        if isinstance(status, dict):
            eta_value = status.get("eta_seconds")
            if isinstance(eta_value, (int, float)) and eta_value >= 0:
                return {"eta_seconds": float(eta_value)}
            eta_fallback = status.get("eta")
            if isinstance(eta_fallback, (int, float)) and eta_fallback >= 0:
                return {"eta_seconds": float(eta_fallback)}
        return None

    def notify_progress(
        step_id: str,
        fraction: float,
        *,
        message: str | None = None,
        extra: dict[str, Any] | None = None,
    ) -> None:
        if not observer:
            return

        payload: dict[str, Any] = {}
        if extra:
            payload.update(extra)

        started = step_timers.get(step_id)
        if started is not None:
            elapsed = max(0.0, time.perf_counter() - started)
            payload.setdefault("elapsed_seconds", elapsed)
            if fraction >= 1:
                payload.setdefault("eta_seconds", 0.0)
                step_timers.pop(step_id, None)
            elif fraction > 0:
                estimated_total = elapsed / max(fraction, 1e-6)
                eta_estimate = max(0.0, estimated_total - elapsed)
                payload.setdefault("eta_seconds", eta_estimate)

        report_step_progress(
            step_id,
            fraction,
            observer=observer,
            message=message,
            extra=payload or None,
        )

    def run_pipeline_step(
        title: str,
        func: Callable[[], TStepResult],
        *,
        step_key: str,
    ) -> TStepResult:
        step_timers[step_key] = time.perf_counter()
        try:
            return run_step(title, func, step_id=step_key, observer=observer)
        finally:
            step_timers.pop(step_key, None)

    if observer:
        observer.handle_event(
            PipelineEvent(
                type=PipelineEventType.PIPELINE_STARTED,
                message="Pipeline started",
                data={
                    "url": source_url,
                    "account": account,
                    "tone": tone.value if tone else None,
                    "source": source.event_payload(),
                },
            )
        )

    twitch = bool(source_url and is_twitch_url(source_url))
    transcript_source = "whisper" if twitch or source.kind == "upload" else TRANSCRIPT_SOURCE

    def should_run(step: int) -> bool:
        return START_AT_STEP <= step

    if source.kind == "url" and source_url:
        video_info = get_video_info(source_url)
    else:
        if source.path is None or not source.path.exists():
            message = (
                f"{Fore.RED}Uploaded video file is no longer available at {source.path}{Style.RESET_ALL}"
            )
            emit_log(message, level="error")
            if observer:
                observer.handle_event(
                    PipelineEvent(
                        type=PipelineEventType.PIPELINE_COMPLETED,
                        message="Pipeline failed",
                        data={
                            "success": False,
                            "error": "Uploaded video file could not be accessed",
                        },
                    )
                )
            return

        probed_duration = probe_media_duration(source.path)
        video_info = {
            "title": source.filename or source.path.stem,
            "upload_date": datetime.utcnow().strftime("%Y%m%d"),
            "uploader": "Uploaded video",
            "duration": probed_duration,
        }

    if not video_info:
        message = f"{Fore.RED}Failed to retrieve video information for {source_label}.{Style.RESET_ALL}"
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

    source_duration_seconds: float | None = None
    info_duration = video_info.get("duration")
    if isinstance(info_duration, (int, float)) and math.isfinite(info_duration) and info_duration > 0:
        source_duration_seconds = float(info_duration)

    source_title = video_info.get("title", "Unknown Title")
    uploader = video_info.get("uploader") or "Unknown Channel"
    raw_upload = str(video_info.get("upload_date") or "Unknown_Date")
    published_iso: str | None = None
    if len(raw_upload) >= 8 and raw_upload[:8].isdigit():
        date_token = raw_upload[:8]
        try:
            parsed_date = datetime.strptime(date_token, "%Y%m%d").replace(tzinfo=timezone.utc)
        except ValueError:
            safe_upload = "Unknown_Date"
        else:
            published_iso = parsed_date.isoformat()
            safe_upload = f"{date_token[:4]}{date_token[4:6]}{date_token[6:]}"
    else:
        safe_upload = "Unknown_Date"
    sanitized_title = sanitize_filename(source_title)
    non_suffix_filename = f"{sanitized_title}_{safe_upload}"
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
    video_extension = ".mp4"
    if source.kind == "upload" and source.path is not None:
        suffix = source.path.suffix
        video_extension = suffix if suffix else ".mp4"
    video_output_path = project_dir / f"{non_suffix_filename}{video_extension}"

    def update_source_duration_from_file() -> None:
        nonlocal source_duration_seconds
        try:
            probed = probe_media_duration(video_output_path)
        except Exception:
            probed = None
        if probed is not None and math.isfinite(probed) and probed > 0:
            source_duration_seconds = float(probed)

    def step_download() -> None:
        if video_output_path.exists() and video_output_path.stat().st_size > 0:
            emit_log(
                f"{Fore.GREEN}STEP 1: Video already present -> {video_output_path}{Style.RESET_ALL}"
            )
            notify_progress(
                "step_1_download",
                1.0,
                message="Video already downloaded",
            )
        elif source.kind == "upload":
            assert source.path is not None
            emit_log(
                f"{Fore.CYAN}STEP 1: Copying uploaded video -> {video_output_path}{Style.RESET_ALL}"
            )
            shutil.copy2(source.path, video_output_path)
            notify_progress(
                "step_1_download",
                1.0,
                message="Uploaded file saved",
            )
        else:
            if not source_url:
                raise ValueError("Pipeline source URL is required for remote downloads")
            download_video(
                source_url,
                str(video_output_path),
                progress_callback=lambda fraction, status: notify_progress(
                    "step_1_download",
                    fraction,
                    message=f"Downloading video {fraction * 100:.0f}%",
                    extra=build_eta_extra(status),
                ),
            )
        update_source_duration_from_file()

    if should_run(1):
        run_pipeline_step(
            f"STEP 1: Downloading video -> {video_output_path}",
            step_download,
            step_key="step_1_download",
        )
    else:
        emit_log(
            f"{Fore.YELLOW}Skipping STEP 1: assuming video exists at {video_output_path}{Style.RESET_ALL}",
            level="warning",
        )
        if video_output_path.exists():
            update_source_duration_from_file()

    # ----------------------
    # STEP 2: Acquire Audio
    # ----------------------
    audio_output_path = project_dir / f"{non_suffix_filename}.wav"

    def step_audio() -> bool:
        return ensure_audio(
            source_url,
            str(audio_output_path),
            str(video_output_path),
            progress_callback=lambda fraction, stage, status=None: notify_progress(
                "step_2_audio",
                fraction,
                message=(
                    "Audio already available"
                    if stage == "cached"
                    else f"Acquiring audio ({stage}) {fraction * 100:.0f}%"
                ),
                extra=build_eta_extra(status),
            ),
        )

    if should_run(2):
        audio_ok = run_pipeline_step(
            f"STEP 2: Ensuring audio -> {audio_output_path}",
            step_audio,
            step_key="step_2_audio",
        )
        if not audio_ok:
            emit_log(
                f"{Fore.YELLOW}STEP 2: Failed to acquire audio (direct + video-extract fallbacks tried).{Style.RESET_ALL}",
                level="warning",
            )
            send_failure_email(
                "Audio acquisition failed",
                f"Failed to acquire audio for video {source_label}",
            )
    else:
        audio_ok = audio_output_path.exists()
        emit_log(
            f"{Fore.YELLOW}Skipping STEP 2: assuming audio exists at {audio_output_path}{Style.RESET_ALL}",
            level="warning",
        )
        if audio_ok:
            notify_progress(
                "step_2_audio",
                1.0,
                message="Audio already available",
            )

    # ----------------------
    # STEP 3: Get Text (Transcript or Transcription)
    # ----------------------
    transcript_output_path = project_dir / f"{non_suffix_filename}.txt"

    def step_download_transcript(step_key: str = "step_3_download_transcript") -> bool:
        if not source_url:
            emit_log(
                f"{Fore.YELLOW}STEP 3: Transcript download skipped because no source URL is available.{Style.RESET_ALL}",
                level="warning",
            )
            return False
        notify_progress(
            step_key,
            0.05,
            message="Requesting transcript from source",
        )
        success = download_transcript(
            source_url,
            str(transcript_output_path),
            languages=["en", "en-US", "en-GB"],
        )
        if success:
            notify_progress(
                step_key,
                1.0,
                message="Transcript downloaded",
            )
        return success

    def run_transcribe(step_key: str) -> bool:
        result = transcribe_audio(
            str(audio_output_path),
            model_size=WHISPER_MODEL,
            progress_callback=lambda fraction: notify_progress(
                step_key,
                fraction,
                message=f"Transcribing audio {fraction * 100:.0f}%",
            ),
        )
        write_transcript_txt(result, str(transcript_output_path))
        return True

    if should_run(3):
        if transcript_source == "whisper":
            yt_ok = False
            transcribed = False
            if audio_ok:
                transcribed = run_pipeline_step(
                    f"STEP 3: Transcribing with faster-whisper ({WHISPER_MODEL})",
                    lambda: run_transcribe("step_3_transcribe"),
                    step_key="step_3_transcribe",
                )
                if transcribed:
                    emit_log(
                        f"{Fore.GREEN}STEP 3: Transcription saved -> {transcript_output_path}{Style.RESET_ALL}"
                    )
            if not transcribed:
                yt_ok = run_pipeline_step(
                    f"STEP 3: Attempting YouTube transcript -> {transcript_output_path}",
                    step_download_transcript,
                    step_key="step_3_download_transcript",
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
                    run_pipeline_step(
                        f"STEP 3: Transcribing with faster-whisper ({WHISPER_MODEL})",
                        lambda: run_transcribe("step_3_transcribe_retry"),
                        step_key="step_3_transcribe_retry",
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
                    f"No transcript could be retrieved or generated for video {source_label} because audio acquisition failed.",
                )
        else:
            yt_ok = run_pipeline_step(
                f"STEP 3: Attempting YouTube transcript -> {transcript_output_path}",
                step_download_transcript,
                step_key="step_3_download_transcript",
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
                    run_pipeline_step(
                        f"STEP 3: Transcribing with faster-whisper ({WHISPER_MODEL})",
                        lambda: run_transcribe("step_3_transcribe"),
                        step_key="step_3_transcribe",
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
                        f"No transcript could be retrieved or generated for video {source_label} because audio acquisition failed.",
                    )
                else:
                    run_pipeline_step(
                        f"STEP 3: Transcribing with faster-whisper ({WHISPER_MODEL})",
                        lambda: run_transcribe("step_3_transcribe"),
                        step_key="step_3_transcribe",
                    )
                    emit_log(
                        f"{Fore.GREEN}STEP 3: Transcription saved -> {transcript_output_path}{Style.RESET_ALL}"
                    )
    else:
        emit_log(
            f"{Fore.YELLOW}Skipping STEP 3: assuming transcript exists at {transcript_output_path}{Style.RESET_ALL}",
            level="warning",
        )
        if transcript_output_path.exists():
            notify_progress(
                "step_3_download_transcript",
                1.0,
                message="Transcript already available",
            )

    # ----------------------
    # STEP 4: Detect Silence Segments
    # ----------------------
    silences_path = project_dir / "silences.json"
    audio_duration_hint = (
        probe_media_duration(audio_output_path)
        if audio_output_path.exists()
        else None
    )

    def step_silences() -> list[tuple[float, float]]:
        silences = (
            detect_silences(
                str(audio_output_path),
                noise=SILENCE_DETECTION_NOISE,
                min_duration=SILENCE_DETECTION_MIN_DURATION,
                progress_callback=lambda fraction, timestamp: notify_progress(
                    "step_4_silences",
                    fraction,
                    message=(
                        "Silence detection complete"
                        if fraction >= 1
                        else f"Scanning audio — {timestamp:.0f}s analysed"
                    ),
                    extra=(
                        {"eta_seconds": max(0.0, (audio_duration_hint or 0.0) - timestamp)}
                        if audio_duration_hint is not None
                        else None
                    ),
                ),
                duration_hint=audio_duration_hint,
            )
            if audio_ok
            else []
        )
        write_silences_json(silences, silences_path)
        return silences

    if should_run(4):
        silences = run_pipeline_step(
            f"STEP 4: Detecting silences -> {silences_path}",
            step_silences,
            step_key="step_4_silences",
        )
    else:
        if silences_path.exists():
            data = json.loads(silences_path.read_text(encoding="utf-8"))
            silences = [tuple(d.values()) for d in data]
            emit_log(
                f"{Fore.YELLOW}Skipping STEP 4: loaded {len(silences)} silences from {silences_path}{Style.RESET_ALL}",
                level="warning",
            )
            notify_progress(
                "step_4_silences",
                1.0,
                message="Silence metadata already available",
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
    DETECTION_WEIGHT = 0.4
    REFINEMENT_WEIGHT = 1.0 - DETECTION_WEIGHT

    def detection_progress(fraction: float, *, message: str | None = None) -> None:
        clamped = max(0.0, min(1.0, fraction))
        notify_progress(
            "step_5_dialog_ranges",
            DETECTION_WEIGHT * clamped,
            message=message,
        )

    def refinement_progress(fraction: float, *, message: str | None = None) -> None:
        clamped = max(0.0, min(1.0, fraction))
        notify_progress(
            "step_5_dialog_ranges",
            DETECTION_WEIGHT + REFINEMENT_WEIGHT * clamped,
            message=message,
        )

    dialog_ranges_path = project_dir / "dialog_ranges.json"
    if should_run(5):
        if dialog_ranges_path.exists() and not (FORCE_REBUILD or FORCE_REBUILD_DIALOG):
            dialog_ranges = load_dialog_ranges_json(dialog_ranges_path)
            emit_log(
                f"{Fore.YELLOW}Skipping STEP 5: loaded dialog ranges from {dialog_ranges_path}{Style.RESET_ALL}",
                level="warning",
            )
            detection_progress(1.0, message="Dialog metadata already available")
        else:
            def step_dialog_ranges() -> list[tuple[float, float]]:
                emit_log(
                    f"[Pipeline] Starting dialog detection using transcript: {transcript_output_path}"
                )
                detection_progress(0.0, message="Detecting dialog-heavy regions")

                def handle_detection_progress(local_fraction: float) -> None:
                    detection_progress(
                        local_fraction,
                        message="Detecting dialog-heavy regions",
                    )

                ranges = detect_dialog_ranges(
                    transcript_output_path,
                    progress_callback=handle_detection_progress,
                )
                write_dialog_ranges_json(ranges, dialog_ranges_path)
                detection_progress(1.0, message="Dialog analysis complete")
                return ranges

            dialog_ranges = run_pipeline_step(
                f"STEP 5: Detecting dialog ranges -> {dialog_ranges_path}",
                step_dialog_ranges,
                step_key="step_5_dialog_ranges",
            )
    else:
        if dialog_ranges_path.exists():
            dialog_ranges = load_dialog_ranges_json(dialog_ranges_path)
            emit_log(
                f"{Fore.YELLOW}Skipping STEP 5: loaded dialog ranges from {dialog_ranges_path}{Style.RESET_ALL}",
                level="warning",
            )
            detection_progress(1.0, message="Dialog metadata already available")
        else:
            dialog_ranges = []
            emit_log(
                f"{Fore.YELLOW}Skipping STEP 5: no existing dialog ranges at {dialog_ranges_path}{Style.RESET_ALL}",
                level="warning",
            )
            detection_progress(1.0, message="Dialog analysis skipped")
    emit_log(f"[Pipeline] Loaded {len(dialog_ranges)} dialog ranges")

    segments_path = project_dir / "segments.json"

    if should_run(5):
        if segments_path.exists() and not (FORCE_REBUILD or FORCE_REBUILD_SEGMENTS):
            segments_data = json.loads(segments_path.read_text(encoding="utf-8"))
            segments = [(d["start"], d["end"], d["text"]) for d in segments_data]
            emit_log(
                f"{Fore.YELLOW}Skipping STEP 5: loaded segments from {segments_path}{Style.RESET_ALL}",
                level="warning",
            )
            refinement_progress(1.0, message="Transcript structure already available")
        else:
            def step_segments() -> list[tuple[float, float, str]]:
                refinement_progress(0.0, message="Parsing transcript for segmentation")
                items = parse_transcript(transcript_output_path)
                refinement_progress(0.2, message="Building segment windows")
                segs = segment_transcript_items(items)
                if USE_LLM_FOR_SEGMENTS:
                    refinement_progress(0.3, message="Refining segments with language model")

                    def handle_refine_progress(processed: int, total: int) -> None:
                        if total <= 0:
                            local_fraction = 0.8
                        else:
                            span = 0.5
                            progress = processed / total
                            local_fraction = 0.3 + span * max(0.0, min(1.0, progress))
                        refinement_progress(
                            local_fraction,
                            message="Refining segments with language model",
                        )

                    segs = maybe_refine_segments_with_llm(
                        segs,
                        progress_callback=handle_refine_progress,
                    )
                else:
                    refinement_progress(0.8, message="Saving structured transcript")

                write_segments_json(segs, segments_path)
                refinement_progress(1.0, message="Transcript structure ready")
                return segs

            segments = run_pipeline_step(
                f"STEP 5: Segmenting transcript -> {segments_path}",
                step_segments,
                step_key="step_5_segments",
            )
    else:
        if segments_path.exists():
            segments_data = json.loads(segments_path.read_text(encoding="utf-8"))
            segments = [(d["start"], d["end"], d["text"]) for d in segments_data]
            emit_log(
                f"{Fore.YELLOW}Skipping STEP 5: loaded segments from {segments_path}{Style.RESET_ALL}",
                level="warning",
            )
            refinement_progress(1.0, message="Transcript structure already available")
        else:
            segments = []
            emit_log(
                f"{Fore.YELLOW}Skipping STEP 5: no existing segments at {segments_path}{Style.RESET_ALL}",
                level="warning",
            )
            refinement_progress(1.0, message="Transcript structure skipped")
    emit_log(f"[Pipeline] Loaded {len(segments)} segments")

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
            def handle_progress(completed: int, total: int) -> None:
                fraction = 0.0 if total <= 0 else max(0.0, min(1.0, completed / total))
                message = (
                    "Candidate search complete"
                    if total > 0 and completed >= total
                    else (
                        f"Scanning window {min(completed, total)}/{total}"
                        if total > 0
                        else "Scanning transcript windows"
                    )
                )
                notify_progress(
                    "step_6_candidates",
                    fraction,
                    message=message,
                    extra={"completed": completed, "total": total},
                )

            return find_candidates_by_tone(
                str(transcript_output_path),
                tone=selected_tone,
                return_all_stages=True,
                segments=segments,
                dialog_ranges=dialog_ranges,
                silences=silences,
                progress_callback=handle_progress,
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
            result = run_pipeline_step(
                "STEP 6: Finding clip candidates from transcript",
                step_candidates,
                step_key="step_6_candidates",
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

        if (
            candidates_path.exists()
            and candidates_all_path.exists()
            and candidates_top_path.exists()
            and not FORCE_REBUILD
        ):
            notify_progress(
                "step_6_candidates",
                1.0,
                message="Loaded cached candidates",
                extra={"completed": 1, "total": 1},
            )
            if observer:
                observer.handle_event(
                    PipelineEvent(
                        type=PipelineEventType.STEP_COMPLETED,
                        message="STEP 6: Using cached candidates",
                        step="step_6_candidates",
                        data={"elapsed_seconds": 0.0},
                    )
                )

        if not candidates:
            emit_log(
                f"{Fore.RED}STEP 6: No clip candidates found.{Style.RESET_ALL}",
                level="error",
            )
            send_failure_email(
                "No clip candidates found",
                f"No clip candidates were found for video {source_label}",
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

                run_pipeline_step(
                    f"STEP 6R.{idx}: Cutting raw clip -> {raw_clips_dir}",
                    step_cut_raw,
                    step_key=f"step_6_raw_cut_{idx}",
                )
                if raw_candidates:
                    notify_progress(
                        "step_6_raw_cut",
                        idx / len(raw_candidates),
                        message=f"Prepared raw clip {idx} of {len(raw_candidates)}",
                        extra={"completed": idx, "total": len(raw_candidates)},
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
        notify_progress(
            "step_6_candidates",
            1.0,
            message="Using existing candidates",
            extra={"completed": len(refined_candidates), "total": len(refined_candidates)},
        )
        if observer:
            observer.handle_event(
                PipelineEvent(
                    type=PipelineEventType.STEP_COMPLETED,
                    message="STEP 6: Using existing candidates",
                    step="step_6_candidates",
                    data={"elapsed_seconds": 0.0},
                )
            )

    total_candidates = len(refined_candidates)

    produce_step_id = "step_7_produce"
    produce_step_label = "STEP 7: Producing final clips"
    produce_started: float | None = None

    if total_candidates:
        produce_started = time.perf_counter()
        step_timers[produce_step_id] = produce_started
        if observer:
            observer.handle_event(
                PipelineEvent(
                    type=PipelineEventType.STEP_STARTED,
                    message=produce_step_label,
                    step=produce_step_id,
                )
            )
        notify_progress(
            produce_step_id,
            0.0,
            message=f"Producing {total_candidates} clips",
            extra={"completed": 0, "total": total_candidates},
        )
        notify_progress(
            "step_7_cut",
            0.0,
            message="Preparing to cut clips",
            extra={"completed": 0, "total": total_candidates},
        )
        notify_progress(
            "step_7_subtitles",
            0.0,
            message="Waiting to generate subtitles",
            extra={"completed": 0, "total": total_candidates},
        )
        notify_progress(
            "step_7_render",
            0.0,
            message="Preparing renders",
            extra={"completed": 0, "total": total_candidates},
        )
        notify_progress(
            "step_7_descriptions",
            0.0,
            message="Preparing descriptions",
            extra={"completed": 0, "total": total_candidates},
        )
    else:
        if observer:
            observer.handle_event(
                PipelineEvent(
                    type=PipelineEventType.STEP_STARTED,
                    message=produce_step_label,
                    step=produce_step_id,
                )
            )
        notify_progress(
            produce_step_id,
            1.0,
            message="No clips ready to produce",
            extra={"completed": 0, "total": 0},
        )
        if observer:
            observer.handle_event(
                PipelineEvent(
                    type=PipelineEventType.STEP_COMPLETED,
                    message=produce_step_label,
                    step=produce_step_id,
                    data={"elapsed_seconds": 0.0},
                )
            )

    produced_count = 0

    for idx, candidate in enumerate(refined_candidates, start=1):
        def step_cut() -> Path | None:
            return save_clip_from_candidate(video_output_path, clips_dir, candidate)

        if should_run(6):
            clip_path = run_pipeline_step(
                f"STEP 7.{idx}: Cutting clip -> {clips_dir}",
                step_cut,
                step_key=f"step_7_cut_{idx}",
            )
            if clip_path is None:
                emit_log(
                    f"{Fore.RED}STEP 7.{idx}: Failed to cut clip.{Style.RESET_ALL}",
                    level="error",
                )
                send_failure_email(
                    "Clip cutting failed",
                    f"Failed to cut clip {idx} for video {source_label}",
                )
                continue
        else:
            clip_path = clips_dir / (
                f"clip_{candidate.start:.2f}-{candidate.end:.2f}_r{candidate.rating:.1f}.mp4"
            )
            if not clip_path.exists():
                emit_log(
                    f"{Fore.RED}STEP 7.{idx}: Expected clip not found -> {clip_path}{Style.RESET_ALL}",
                    level="error",
                )
                continue

        if total_candidates:
            notify_progress(
                "step_7_cut",
                idx / total_candidates,
                message=f"Cut {idx} of {total_candidates} clips",
                extra={"completed": idx, "total": total_candidates},
            )

        srt_path = subtitles_dir / f"{clip_path.stem}.srt"

        def step_subtitles() -> Path:
            return build_srt_for_range(
                transcript_output_path,
                global_start=candidate.start,
                global_end=candidate.end,
                srt_path=srt_path,
            )

        if should_run(7):
            run_pipeline_step(
                f"STEP 7.{idx}: Generating subtitles -> {srt_path}",
                step_subtitles,
                step_key=f"step_7_subtitles_{idx}",
            )
        else:
            emit_log(
                f"{Fore.YELLOW}Skipping STEP 7.{idx}: assuming subtitles exist at {srt_path}{Style.RESET_ALL}",
                level="warning",
            )
        if total_candidates:
            notify_progress(
                "step_7_subtitles",
                idx / total_candidates,
                message=f"Subtitles generated for clip {idx}/{total_candidates}",
                extra={"completed": idx, "total": total_candidates},
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
            run_pipeline_step(
                f"STEP 7.{idx}: Rendering vertical video with captions -> {vertical_output}",
                step_render,
                step_key=f"step_7_render_{idx}",
            )
        else:
            emit_log(
                f"{Fore.YELLOW}Skipping STEP 7.{idx}: assuming video exists at {vertical_output}{Style.RESET_ALL}",
                level="warning",
            )
        if total_candidates:
            notify_progress(
                "step_7_render",
                idx / total_candidates,
                message=f"Rendered {idx} of {total_candidates} clips",
                extra={"completed": idx, "total": total_candidates},
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
                    f"No hashtags generated for clip {idx} of video {source_label}",
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
            full_video_link = youtube_timestamp_url(source_url, candidate.start) if source_url else None
            credited_channel = video_info.get("uploader", "Unknown Channel")
            credited_title = video_info.get("title") or "Original video"
            link_prefix = f"Full video: {full_video_link}\n\n" if full_video_link else ""
            description = (
                f"{link_prefix}"
                f"Credit: {credited_channel} — {credited_title}\n"
                "Made by Atropos\n"
            )
            description = maybe_append_website_link(description)
            description += "\nIf you know any more creators who don't do clips, leave them in the comments below!\n"
            description += "\n" + " ".join(hashtags)
            description_path.write_text(description, encoding="utf-8")
            return description_path

        if should_run(9):
            run_pipeline_step(
                f"STEP 7.{idx}: Writing description -> {description_path}",
                step_description,
                step_key=f"step_7_descriptions_{idx}",
            )
        else:
            emit_log(
                f"{Fore.YELLOW}Skipping STEP 7.{idx}: assuming description exists at {description_path}{Style.RESET_ALL}",
                level="warning",
            )
        if total_candidates:
            notify_progress(
                "step_7_descriptions",
                idx / total_candidates,
                message=f"Descriptions prepared for {idx} of {total_candidates} clips",
                extra={"completed": idx, "total": total_candidates},
            )

        if total_candidates:
            produced_count += 1
            notify_progress(
                produce_step_id,
                produced_count / total_candidates,
                message=f"Produced {produced_count} of {total_candidates} clips",
                extra={"completed": produced_count, "total": total_candidates},
            )

        if observer:
            try:
                description_text = description_path.read_text(encoding="utf-8").strip()
            except OSError:
                description_text = ""
            try:
                short_path = vertical_output.relative_to(project_dir)
                short_path_str = short_path.as_posix()
            except ValueError:
                short_path_str = vertical_output.name

            clip_title = (candidate.quote or "").strip() or f"{source_title} — Clip {idx}"
            duration_seconds = max(0.0, candidate.end - candidate.start)
            observer.handle_event(
                PipelineEvent(
                    type=PipelineEventType.CLIP_READY,
                    step=f"step_7_descriptions_{idx}",
                    data={
                        "clip_id": vertical_output.stem,
                        "title": clip_title,
                        "channel": uploader,
                        "description": description_text,
                        "duration_seconds": duration_seconds,
                        "created_at": datetime.now(timezone.utc).isoformat(),
                        "source_url": source_url or video_output_path.as_posix(),
                        "source_title": source_title,
                        "source_published_at": published_iso,
                        "short_path": short_path_str,
                        "project_dir": str(project_dir),
                        "account": account,
                        "quote": candidate.quote,
                        "reason": candidate.reason,
                        "rating": candidate.rating,
                        "start_seconds": float(candidate.start),
                        "end_seconds": float(candidate.end),
                        "original_start_seconds": float(candidate.start),
                        "original_end_seconds": float(candidate.end),
                        "source_duration_seconds": (
                            float(source_duration_seconds)
                            if source_duration_seconds is not None
                            else None
                        ),
                    },
                )
            )

    if pause_for_review and total_candidates and review_gate is not None:
        emit_log(
            "Pausing after clip production for manual review. Resume when adjustments are complete.",
            level="info",
        )
        if observer:
            observer.handle_event(
                PipelineEvent(
                    type=PipelineEventType.LOG,
                    message="Awaiting manual clip review before completion.",
                    data={"status": "waiting_for_review"},
                )
            )
        review_gate()
        emit_log("Resuming pipeline after manual review.", level="info")

    if total_candidates:
        notify_progress(
            produce_step_id,
            1.0,
            message=f"Finished producing {produced_count} of {total_candidates} clips",
            extra={"completed": produced_count, "total": total_candidates},
        )
        if observer:
            elapsed = 0.0
            if produce_started is not None:
                elapsed = max(0.0, time.perf_counter() - produce_started)
            observer.handle_event(
                PipelineEvent(
                    type=PipelineEventType.STEP_COMPLETED,
                    message=produce_step_label,
                    step=produce_step_id,
                    data={"elapsed_seconds": elapsed, "clips": produced_count},
                )
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
                    "clips_expected": total_candidates,
                    "clips_rendered": produced_count,
                },
            )
        )


if __name__ == "__main__":
    tone = Tone.SCIENCE
    account = "cosmos"
    # Melodysheep: Water Worlds
    # yt_url = "https://www.youtube.com/watch?v=URyiCGZNjdI"
    # General URL
    # start next one at [:10]
    yt_url = "https://www.youtube.com/playlist?list=PLkoaIad9k4NKy7C4Z8YqCYH1drLha_tYf"


    # tone = Tone.FUNNY 
    # account = "funnykinda"
    # # In Review Playlist (newest first)
    # # yt_url = "https://www.youtube.com/playlist?list=PLy3mMHt2i7RKE9ba8rfL7_qnFcpbUaA8_"
    # # KFAF Playlist(newest first)
    # # start next one at [20:]
    # yt_url = "https://www.youtube.com/playlist?list=PLOlEpGVXWUVurPHlIotFyz-cIOXjV_cxx"
    # # Last Of Us
    # # start next one at [2:]
    # # yt_url = "https://www.youtube.com/playlist?list=PLBIL5prmXqedEXXikBxPsvKRREB-DaoWb"


    # tone = Tone.HEALTH
    # account = "health"
    # # Matt Lane: Can I Get Fit On Fast Food?
    # # yt_url = "https://www.youtube.com/watch?v=6J6FI8PAy5E"
    # # Matt Lane: Ask MLFit Show
    # # start next one at [65:]
    # yt_url = "https://www.youtube.com/playlist?list=PLfw1VEbkByghq-SR-HCj0NNTLzRpTVinI"


    tone = Tone.HISTORY
    account = "history"
    # Crash Course World History
    # yt_url = "https://www.youtube.com/playlist?list=PLBDA2E52FB1EF80C9"
    # World History Battles
    # start next one at [60:]
    yt_url = "https://www.youtube.com/playlist?list=PL_gGGlaAre787Q8Wx6sCF5m9podjPcqfx"


    # tone = Tone.CONSPIRACY
    # account = "secrets"
    # # Bright Insight: Lost Civilizations
    # # start next one at [45:]
    # yt_url = "https://www.youtube.com/playlist?list=PL8PPtxxTQjQu7fznaPSkk-WosHgPs5y4Z"


    urls = get_video_urls(yt_url)
    # FUNNYKINDA NEEDS REVERSED
    # urls.reverse() # If the playlist is newest first, reverse to process oldest first
    for url in urls[45:60]:
        process_video(url, account=account, tone=tone)