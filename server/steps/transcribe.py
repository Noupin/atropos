from faster_whisper import WhisperModel

from types.timer import Timer


def transcribe_audio(file_path, model_size="medium"):
    """Transcribe an audio file using faster_whisper."""
    with Timer() as t:
        model = WhisperModel(model_size, device="auto")
        segments, info = model.transcribe(file_path)
    text = "".join([s.text for s in segments])
    segment_list = [
        {
            "start": s.start,
            "end": s.end,
            "text": s.text,
        }
        for s in segments
    ]
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
    model_name = "large-v3-turbo"
    result = transcribe_audio(audio_path, model_name)
    print("Transcription text (first 500 chars):")
    print(result["text"][:500])
    print("\nFirst 12 segments:")
    print(result["segments"][:12])
    print("\nTiming info:")
    print(result["timing"]) 
