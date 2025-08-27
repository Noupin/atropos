from faster_whisper import WhisperModel
from interfaces.timer import Timer


def transcribe_audio(file_path, model_size="medium"):
    """Transcribe an audio file using faster_whisper.

    Returns a dict with the combined text, segment metadata, optional
    word-level timings, and timing information for the transcription run.
    """
    with Timer() as t:
        model = WhisperModel(model_size, device="auto")
        segments, info = model.transcribe(file_path, word_timestamps=True)

    text = "".join([s.text for s in segments])

    segment_list = []
    words: list[dict] = []
    for s in segments:
        segment_list.append({"start": s.start, "end": s.end, "text": s.text})
        for w in getattr(s, "words", []) or []:
            words.append({"start": w.start, "end": w.end, "text": w.word.strip()})

    timing = {
        "start_time": t.start_time,
        "stop_time": t.stop_time,
        "total_time": t.elapsed,
    }
    return {
        "text": text,
        "segments": segment_list,
        "words": words,
        "timing": timing,
    }


if __name__ == "__main__":
    audio_path = "kfaf1.mp3"
    model_name = "large-v3-turbo"
    result = transcribe_audio(audio_path, model_name)
    print("Transcription text (first 500 chars):")
    print(result["text"][:500])
    print("\nFirst 12 segments:")
    print(result["segments"][:12])
    print("\nTiming info:")
    print(result["timing"]) 
