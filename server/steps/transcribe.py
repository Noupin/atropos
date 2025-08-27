from faster_whisper import WhisperModel
from server.interfaces.timer import Timer
import logging


logger = logging.getLogger(__name__)


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


def main(audio_path: str = "kfaf1.mp3", model_name: str = "large-v3-turbo") -> None:
    result = transcribe_audio(audio_path, model_name)
    logger.info("Transcription text (first 500 chars):")
    logger.info(result["text"][:500])
    logger.info("\nFirst 12 segments:")
    logger.info(result["segments"][:12])
    logger.info("\nTiming info:")
    logger.info(result["timing"])


if __name__ == "__main__":  # pragma: no cover
    main()
