from __future__ import annotations

from pathlib import Path

from server.helpers.audio import ensure_audio as _ensure_audio
from server.helpers.transcript import write_transcript_txt
from server.steps.download import download_video as _download_video, download_transcript
from server.steps.transcribe import transcribe_audio
from server.steps.silence import (
    detect_silences as _detect_silences,
    write_silences_json,
    snap_start_to_silence,
    snap_end_to_silence,
)
from server.steps.candidates.funny import find_funny_timestamps_batched
from server.steps.candidates.inspiring import find_inspiring_timestamps_batched
from server.steps.candidates.educational import find_educational_timestamps_batched
from server.steps.candidates.helpers import (
    export_candidates_json,
    parse_transcript,
    _snap_start_to_sentence_start,
    _snap_end_to_sentence_end,
)
from server.steps.segment import segment_transcript_items, write_segments_json
from server.steps.cut import save_clip_from_candidate
from server.steps.subtitle import build_srt_for_range
from server.steps.render import render_vertical_with_captions
from server.steps.candidates import ClipCandidate


CLIP_FINDERS = {
    "funny": find_funny_timestamps_batched,
    "inspiring": find_inspiring_timestamps_batched,
    "educational": find_educational_timestamps_batched,
}


def download_video(yt_url: str, output_path: Path) -> None:
    _download_video(yt_url, str(output_path))


def ensure_audio(yt_url: str, audio_path: Path, video_path: Path) -> bool:
    return _ensure_audio(yt_url, str(audio_path), str(video_path))


def get_transcript(
    yt_url: str,
    transcript_path: Path,
    audio_ok: bool,
    audio_path: Path,
) -> bool:
    if download_transcript(
        yt_url, str(transcript_path), languages=["en", "en-US", "en-GB", "ko"]
    ):
        return True
    if not audio_ok:
        return False
    result = transcribe_audio(str(audio_path))
    write_transcript_txt(result["segments"], str(transcript_path))
    return True


def detect_silences(
    audio_path: Path,
    silences_path: Path,
    audio_ok: bool,
) -> list[tuple[float, float]]:
    silences = _detect_silences(str(audio_path)) if audio_ok else []
    write_silences_json(silences, silences_path)
    return silences


def find_clip_candidates(
    transcript_path: Path,
    clip_type: str,
    min_rating: float,
    project_dir: Path,
) -> list[ClipCandidate]:
    finder = CLIP_FINDERS.get(clip_type)
    if finder is None:
        raise ValueError(f"Unsupported clip type: {clip_type}")
    candidates, top_candidates, all_candidates = finder(
        str(transcript_path),
        min_rating=min_rating,
        return_all_stages=True,
    )
    export_candidates_json(all_candidates, project_dir / "candidates_all.json")
    export_candidates_json(top_candidates, project_dir / "candidates_top.json")
    export_candidates_json(candidates, project_dir / "candidates.json")
    return candidates


def process_candidates(
    candidates: list[ClipCandidate],
    transcript_path: Path,
    audio_path: Path,
    video_path: Path,
    silences: list[tuple[float, float]],
    project_dir: Path,
) -> None:
    if not candidates:
        return
    items = parse_transcript(transcript_path)
    segments = segment_transcript_items(items)
    write_segments_json(segments, project_dir / "segments.json")

    clips_dir = project_dir / "clips"
    subtitles_dir = project_dir / "subtitles"
    shorts_dir = project_dir / "shorts"
    clips_dir.mkdir(parents=True, exist_ok=True)
    subtitles_dir.mkdir(parents=True, exist_ok=True)
    shorts_dir.mkdir(parents=True, exist_ok=True)

    for cand in candidates:
        snapped_start = _snap_start_to_sentence_start(cand.start, segments)
        snapped_end = _snap_end_to_sentence_end(cand.end, segments)
        adj_start = snap_start_to_silence(snapped_start, silences)
        adj_end = snap_end_to_silence(snapped_end, silences)
        candidate = ClipCandidate(
            start=adj_start,
            end=adj_end,
            rating=cand.rating,
            reason=cand.reason,
            quote=cand.quote,
        )
        clip_path = save_clip_from_candidate(video_path, clips_dir, candidate)
        if clip_path is None:
            continue
        srt_path = subtitles_dir / f"{clip_path.stem}.srt"
        build_srt_for_range(
            transcript_path,
            global_start=candidate.start,
            global_end=candidate.end,
            srt_path=srt_path,
        )
        vertical_output = shorts_dir / f"{clip_path.stem}_vertical.mp4"
        render_vertical_with_captions(clip_path, srt_path, vertical_output)
