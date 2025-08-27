import argparse


def create_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Transcribe an audio file")
    parser.add_argument("audio_path", help="Path to the audio file")
    parser.add_argument(
        "--model-size", default="medium", help="Whisper model size to use"
    )
    return parser


def _get_transcribe_audio():
    from server.steps.transcribe import transcribe_audio

    return transcribe_audio


def main(argv: list[str] | None = None) -> None:
    args = create_parser().parse_args(argv)
    transcribe = _get_transcribe_audio()
    transcribe(args.audio_path, args.model_size)


if __name__ == "__main__":  # pragma: no cover
    main()
