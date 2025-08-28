"""Command-line interface for batch video uploads."""

from __future__ import annotations

import argparse
import json

from .batch import upload_folder
from .pipeline import UploadConfig


def load_config(path: str) -> UploadConfig:
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    return UploadConfig(**data)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Upload every video in a folder using per-file metadata",
    )
    parser.add_argument(
        "folder",
        help="Folder containing videos and JSON metadata",
    )
    parser.add_argument(
        "--config",
        default="upload_config.json",
        help="Path to JSON file with account names and access tokens",
    )
    args = parser.parse_args()
    config = load_config(args.config)
    upload_folder(args.folder, config)


if __name__ == "__main__":
    main()
