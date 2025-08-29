"""Orchestrator script for bulk video uploads."""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
import json
import logging
from pathlib import Path
from typing import Dict, List, Tuple

from common.env import load_env


# ---------------------------------------------------------------------------
# Configuration constants

UPLOAD_FOLDER = Path("upload_queue")
TOKEN_STORE_PATH = Path("token_store.enc")
CONFIG_PATH = Path("upload_config.json")

CONCURRENCY = 2
RETRY_ATTEMPTS = 3
RETRY_BASE_DELAY = 1.0

ENABLE_INSTAGRAM = True
ENABLE_FACEBOOK = True
ENABLE_YOUTUBE = True
ENABLE_TIKTOK = True
ENABLE_SNAPCHAT = True
ENABLE_X = True


def main() -> None:
    # Load environment and late imports (requires env)
    load_env()

    from common.token_store import TokenStore
    from common import caption_utils, file_utils, limits, backoff
    from platforms.instagram import auth as ig_auth, upload as ig_upload
    from platforms.facebook import auth as fb_auth, upload as fb_upload
    from platforms.youtube import auth as yt_auth, upload as yt_upload
    from platforms.tiktok import auth as tt_auth, upload as tt_upload
    from platforms.snapchat import auth as sc_auth, upload as sc_upload
    from platforms.x import auth as x_auth, upload as x_upload

    logging.basicConfig(level=logging.INFO, format="%(message)s")
    logger = logging.getLogger("bulk")

    pairs = list(file_utils.iter_video_caption_pairs(UPLOAD_FOLDER))
    if not pairs:
        logger.info("No videos found in %s", UPLOAD_FOLDER)
        return

    config: Dict[str, Dict[str, str]] = {}
    if CONFIG_PATH.exists():
        config = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))

    store = TokenStore(TOKEN_STORE_PATH)
    summary: Dict[str, List[str]] = {}

    platforms: List[Tuple[str, bool, any, any]] = [
        ("instagram", ENABLE_INSTAGRAM, ig_auth, ig_upload),
        ("facebook", ENABLE_FACEBOOK, fb_auth, fb_upload),
        ("youtube", ENABLE_YOUTUBE, yt_auth, yt_upload),
        ("tiktok", ENABLE_TIKTOK, tt_auth, tt_upload),
        ("snapchat", ENABLE_SNAPCHAT, sc_auth, sc_upload),
        ("x", ENABLE_X, x_auth, x_upload),
    ]

    for name, enabled, auth_mod, upload_mod in platforms:
        if not enabled:
            continue
        logger.info("PLAN %s authenticate", name)
        token = auth_mod.authenticate(store, config.get(name, {}))
        results: List[str] = []

        def _upload(video: Path, caption_text: str) -> str:
            def call() -> str:
                return upload_mod.upload_video(token, video, caption_text)

            return backoff.retry(call, RETRY_ATTEMPTS, RETRY_BASE_DELAY)

        with ThreadPoolExecutor(max_workers=CONCURRENCY) as executor:
            future_map = {}
            for video, caption_file in pairs:
                caption_raw = caption_file.read_text(encoding="utf-8")
                caption_text = caption_utils.normalize_caption(
                    caption_raw,
                    limits.PLATFORM_LIMITS[name]["caption"],
                    limits.TOP_N_HASHTAGS,
                    limits.DEFAULT_HASHTAGS,
                )
                logger.info("PLAN %s %s", name, video.name)
                future = executor.submit(_upload, video, caption_text)
                future_map[future] = video

            for future, video in future_map.items():
                try:
                    result = future.result()
                    logger.info("OK %s %s id=%s", name, video.name, result)
                    results.append(result)
                except Exception as exc:  # pragma: no cover - network dependent
                    logger.error("ERR %s %s %s", name, video.name, exc)

        summary[name] = results

    logger.info("Summary:")
    for name, ids in summary.items():
        logger.info("%s: %d uploads", name, len(ids))


if __name__ == "__main__":  # pragma: no cover - script entry point
    main()

