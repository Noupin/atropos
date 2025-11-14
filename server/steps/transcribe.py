from typing import Callable

from faster_whisper import WhisperModel
from interfaces.timer import Timer
from config import WHISPER_MODEL

ProgressCallback = Callable[[float], None]


def transcribe_audio(file_path, model_size=WHISPER_MODEL, progress_callback: ProgressCallback | None = None):
    """Transcribe an audio file using faster_whisper."""
    with Timer() as t:
        model = WhisperModel(model_size, device="auto")
        try:
            segments_iter, info = model.transcribe(
                file_path,
                chunk_length=10,
                beam_size=1,
                temperature=0.0,
                vad_filter=True,
                vad_parameters=dict(threshold=0.6),
                no_speech_threshold=0.6,
                condition_on_previous_text=False,
                word_timestamps=True,
            )
        except TypeError:
            try:
                segments_iter, info = model.transcribe(file_path, word_timestamps=True)
            except TypeError:
                segments_iter, info = model.transcribe(file_path)

        duration = getattr(info, "duration", None)
        segments = []
        for segment in segments_iter:
            segments.append(segment)
            if progress_callback and duration:
                progress_callback(min(0.99, max(0.0, segment.end / duration)))

    if progress_callback:
        progress_callback(1.0)

    text = "".join(s.text for s in segments)
    segment_list = []
    for seg in segments:
        words_data = []
        for w in getattr(seg, "words", []) or []:
            text = getattr(w, "word", "")
            if text is None:
                continue
            cleaned = text.strip()
            if not cleaned:
                continue
            start = getattr(w, "start", None)
            end = getattr(w, "end", None)
            try:
                start_val = float(start) if start is not None else None
                end_val = float(end) if end is not None else None
            except (TypeError, ValueError):
                start_val = end_val = None
            if start_val is None or end_val is None or end_val <= start_val:
                continue
            words_data.append({
                "start": start_val,
                "end": end_val,
                "text": cleaned,
            })

        segment_list.append(
            {
                "start": seg.start,
                "end": seg.end,
                "text": seg.text,
                "words": words_data,
            }
        )
    timing = {
        "start_time": t.start_time,
        "stop_time": t.stop_time,
        "total_time": t.elapsed,
    }
    return {
        "text": text,
        "segments": segment_list,
        "timing": timing,
    }


if __name__ == "__main__":
    audio_path = "kfaf1.mp3"
    result = transcribe_audio(audio_path)
    print("Transcription text (first 500 chars):")
    print(result["text"][:500])
    print("\nFirst 12 segments:")
    print(result["segments"][:12])
    print("\nTiming info:")
    print(result["timing"]) 
