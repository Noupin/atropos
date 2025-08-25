from faster_whisper import WhisperModel
import time

def transcribe_audio(file_path, model_size="medium"):
    """
    Transcribe an audio file using faster_whisper.
    Returns a dict with transcription text, segments, and timing info.
    """
    start_time = time.time()
    model = WhisperModel(model_size, device="auto")  # or "cuda" / "metal" if you use those backends
    segments, info = model.transcribe(file_path)
    stop_time = time.time()
    text = "".join([s.text for s in segments])
    segment_list = [
        {
            "start": s.start,
            "end": s.end,
            "text": s.text
        }
        for s in segments
    ]
    timing = {
        "start_time": start_time,
        "stop_time": stop_time,
        "total_time": stop_time - start_time
    }
    return {
        "text": text,
        "segments": segment_list,
        "timing": timing
    }

# Example usage
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