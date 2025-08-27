from __future__ import annotations

import argparse

from . import run_pipeline


def create_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run the Atropos pipeline")
    parser.add_argument("yt_url", help="YouTube video URL")
    parser.add_argument(
        "--clip-type",
        choices=["funny", "inspiring", "educational"],
        default="funny",
        help="Type of clip to extract",
    )
    parser.add_argument(
        "--min-rating", type=float, default=7.0, help="Minimum rating threshold"
    )
    return parser


def main(argv: list[str] | None = None) -> None:
    args = create_parser().parse_args(argv)
    run_pipeline(args.yt_url, args.clip_type, args.min_rating)
