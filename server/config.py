"""Central configuration for server pipeline and candidate processing.

Sections are grouped by feature for easier editing.
"""

import os
import platform
from pathlib import Path

# ---------------------------------------
# Rendering and clip boundary parameters
# ---------------------------------------
# Default baseline caption font scale for rendered videos
CAPTION_FONT_SCALE = 2.0
# Maximum number of lines per caption before splitting
CAPTION_MAX_LINES: int = 2
# Toggle whether rendered captions use custom colors
CAPTION_USE_COLORS = True
# Default caption fill and outline colors in BGR (blue-green-red) order
CAPTION_FILL_BGR = (255, 187, 28)  # hex 1cbbff -> RGB(28,187,255) -> BGR(255,187,28)
CAPTION_OUTLINE_BGR = (236, 236, 236)  # hex ececec
# Constant frame-rate to avoid VFR issues on platforms like TikTok/Reels
OUTPUT_FPS: float = 30.0

# Clip boundary snapping options
SNAP_TO_SILENCE = True
SNAP_TO_DIALOG = False
SNAP_TO_SENTENCE = True

# Toggle LLM usage for transcript segmentation
USE_LLM_FOR_SEGMENTS = True
# Toggle LLM-based detection of dialog ranges
DETECT_DIALOG_WITH_LLM = False
MAX_LLM_CHARS = 24_000
LLM_API_TIMEOUT = 600  # seconds
# LLM segmentation and worker configuration
SEGMENT_OR_DIALOG_CHUNK_MAX_ITEMS = 20
LLM_MAX_WORKERS = 2
SEGMENT_OR_DIALOG_CHUNK_MAX_ITEMS = 25
LLM_MAX_WORKERS = 1
LLM_PER_CHUNK_TIMEOUT = 60  # seconds

# Choose local LLM provider and model
LOCAL_LLM_PROVIDER = os.environ.get(
    "LOCAL_LLM_PROVIDER",
    "lmstudio" if platform.system() == "Darwin" else "ollama",
)
LOCAL_LLM_MODEL = os.environ.get("LOCAL_LLM_MODEL", "google/gemma-3-4b")

# Export silence-only "raw" clips for debugging comparisons
EXPORT_RAW_CLIPS = False
# Limit number of raw clips to avoid excessive disk use
RAW_LIMIT = 10

# Silence detection thresholds
SILENCE_DETECTION_NOISE = "-30dB"
SILENCE_DETECTION_MIN_DURATION = 0.075

# ---------------------------------------
# Transcript acquisition settings
# ---------------------------------------
# Preferred transcript source: "youtube" or "whisper"
TRANSCRIPT_SOURCE = "youtube"
# Model used for faster-whisper transcription
WHISPER_MODEL = os.environ.get(
    "WHISPER_MODEL",
    "large-v3-turbo",  # (tiny, tiny.en, base, base.en, small, small.en, distil-small.en, medium, medium.en, distil-medium.en, large-v1, large-v2, large-v3, large, distil-large-v2, distil-large-v3, large-v3-turbo, or turbo)
)

# ---------------------------------------
# Clip selection
# ---------------------------------------
# Choose which type of clips to generate
CLIP_TYPE = "funny"  # or "space", "history", "tech", "health"

# ---------------------------------------
# Candidate selection heuristics
# ---------------------------------------
MIN_DURATION_SECONDS = 6.0
MAX_DURATION_SECONDS = 90.0
SWEET_SPOT_MIN_SECONDS = 8.0
SWEET_SPOT_MAX_SECONDS = 35.0

DEFAULT_MIN_RATING = 7.0
DEFAULT_MIN_WORDS = 0

FUNNY_MIN_RATING = 9.0
FUNNY_MIN_WORDS = 5

# ---------------------------------------
# Pipeline and batching controls
# ---------------------------------------
# Whether to rebuild all cached artifacts
FORCE_REBUILD = False
# Fine-grained rebuild toggles
FORCE_REBUILD_SEGMENTS = False
FORCE_REBUILD_DIALOG = False
WINDOW_SIZE_SECONDS = 30.0
WINDOW_OVERLAP_SECONDS = 10.0
WINDOW_CONTEXT_SECONDS = 2.0
RATING_MIN = 0.0
RATING_MAX = 10.0
MIN_EXTENSION_MARGIN = 0.3

# Step control
# Allows skipping the first N pipeline steps by setting START_AT_STEP
# via environment variable. Defaults to 1 (run all steps).
START_AT_STEP = int(os.environ.get("START_AT_STEP", "1"))

# ---------------------------------------
# Post-pipeline cleanup
# ---------------------------------------
# Remove all non-short artifacts after pipeline run
CLEANUP_NON_SHORTS = False

# ---------------------------------------
# Multi-platform upload settings
# ---------------------------------------
TOKENS_DIR = Path(__file__).with_name("tokens")

YOUTUBE_PRIVACY = "public"
YOUTUBE_CATEGORY_ID = "23"

# PRIVACY_LEVEL can be PUBLIC_TO_EVERYONE, MUTUAL_FOLLOW_FRIENDS, or SELF_ONLY
TIKTOK_PRIVACY_LEVEL = "SELF_ONLY"
TIKTOK_CHUNK_SIZE = 10_000_000  # bytes

# Upload backend can be "api" or "autouploader"
TIKTOK_UPLOAD_BACKEND = os.environ.get("TIKTOK_UPLOAD_BACKEND", "autouploader")

# Settings for the browser-based uploader
TIKTOK_AUTO_HEADLESS = (
    os.environ.get("TIKTOK_AUTO_HEADLESS", "false").lower() == "true"
)
TIKTOK_AUTO_BROWSER = os.environ.get("TIKTOK_AUTO_BROWSER", "chromium")
TIKTOK_AUTO_COOKIES_PATH = Path(
    os.environ.get(
        "TIKTOK_AUTO_COOKIES_PATH", TOKENS_DIR / "tiktok_cookies.json"
    )
)
TIKTOK_AUTO_TIMEOUT_SEC = int(os.environ.get("TIKTOK_AUTO_TIMEOUT_SEC", "180"))
TIKTOK_AUTO_MAX_RETRIES = int(os.environ.get("TIKTOK_AUTO_MAX_RETRIES", "2"))
TIKTOK_AUTO_RETRY_BACKOFF_SEC = int(
    os.environ.get("TIKTOK_AUTO_RETRY_BACKOFF_SEC", "8")
)
TIKTOK_AUTO_PROXY = os.environ.get("TIKTOK_AUTO_PROXY", "")
TIKTOK_AUTO_UPLOAD_URL = os.environ.get("TIKTOK_AUTO_UPLOAD_URL", "")

# Optional website link to append to video descriptions
INCLUDE_WEBSITE_LINK = True
WEBSITE_URL = "https://atropos-video.com"
# Platform-specific description length limits
YOUTUBE_DESC_LIMIT = 5000
TIKTOK_DESC_LIMIT = 2000

__all__ = [
    "CAPTION_FONT_SCALE",
    "CAPTION_MAX_LINES",
    "CAPTION_USE_COLORS",
    "CAPTION_FILL_BGR",
    "CAPTION_OUTLINE_BGR",
    "SNAP_TO_SILENCE",
    "SNAP_TO_DIALOG",
    "SNAP_TO_SENTENCE",
    "USE_LLM_FOR_SEGMENTS",
    "DETECT_DIALOG_WITH_LLM",
    "LOCAL_LLM_PROVIDER",
    "LOCAL_LLM_MODEL",
    "MAX_LLM_CHARS",
    "LLM_API_TIMEOUT",
    "SEGMENT_OR_DIALOG_CHUNK_MAX_ITEMS",
    "LLM_MAX_WORKERS",
    "LLM_PER_CHUNK_TIMEOUT",
    "EXPORT_RAW_CLIPS",
    "RAW_LIMIT",
    "SILENCE_DETECTION_NOISE",
    "SILENCE_DETECTION_MIN_DURATION",
    "TRANSCRIPT_SOURCE",
    "WHISPER_MODEL",
    "CLIP_TYPE",
    "MIN_DURATION_SECONDS",
    "MAX_DURATION_SECONDS",
    "SWEET_SPOT_MIN_SECONDS",
    "SWEET_SPOT_MAX_SECONDS",
    "DEFAULT_MIN_RATING",
    "DEFAULT_MIN_WORDS",
    "FUNNY_MIN_RATING",
    "FUNNY_MIN_WORDS",
    "FORCE_REBUILD",
    "FORCE_REBUILD_SEGMENTS",
    "FORCE_REBUILD_DIALOG",
    "WINDOW_SIZE_SECONDS",
    "WINDOW_OVERLAP_SECONDS",
    "WINDOW_CONTEXT_SECONDS",
    "RATING_MIN",
    "RATING_MAX",
    "MIN_EXTENSION_MARGIN",
    "START_AT_STEP",
    "CLEANUP_NON_SHORTS",
    "TOKENS_DIR",
    "YOUTUBE_PRIVACY",
    "YOUTUBE_CATEGORY_ID",
    "TIKTOK_PRIVACY_LEVEL",
    "TIKTOK_CHUNK_SIZE",
    "TIKTOK_UPLOAD_BACKEND",
    "TIKTOK_AUTO_HEADLESS",
    "TIKTOK_AUTO_BROWSER",
    "TIKTOK_AUTO_COOKIES_PATH",
    "TIKTOK_AUTO_TIMEOUT_SEC",
    "TIKTOK_AUTO_MAX_RETRIES",
    "TIKTOK_AUTO_RETRY_BACKOFF_SEC",
    "TIKTOK_AUTO_PROXY",
    "TIKTOK_AUTO_UPLOAD_URL",
    "INCLUDE_WEBSITE_LINK",
    "WEBSITE_URL",
    "YOUTUBE_DESC_LIMIT",
    "TIKTOK_DESC_LIMIT",
]
