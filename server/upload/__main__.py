"""Command-line interface for batch video uploads."""

from __future__ import annotations

import json

from .batch import upload_folder
from .pipeline import UploadConfig


UPLOAD_FOLDER = "path/to/videos"
CONFIG_PATH = "upload_config.json"


def load_config(path: str) -> UploadConfig:
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    return UploadConfig(**data)


def main() -> None:
    config = load_config(CONFIG_PATH)
    upload_folder(UPLOAD_FOLDER, config)


if __name__ == "__main__":
    main()
