import argparse


def create_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Download a transcript from a YouTube video"
    )
    parser.add_argument("yt_url", help="YouTube video URL or ID")
    parser.add_argument(
        "--output", default="transcript.txt", help="Path to save the transcript"
    )
    return parser


def _get_download_transcript():
    from server.steps.download import download_transcript

    return download_transcript


def main(argv: list[str] | None = None) -> None:
    args = create_parser().parse_args(argv)
    download = _get_download_transcript()
    download(args.yt_url, args.output)


if __name__ == "__main__":  # pragma: no cover
    main()
