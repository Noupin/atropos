"""Central configuration for server pipeline and candidate processing.

Sections are grouped by feature for easier editing.
"""

import os
from pathlib import Path

# ---------------------------------------
# Rendering and clip boundary parameters
# ---------------------------------------
# Default baseline caption font scale for rendered videos
CAPTION_FONT_SCALE = 2.0
# Maximum number of lines per caption before splitting
CAPTION_MAX_LINES: int = 2
# Constant frame-rate to avoid VFR issues on platforms like TikTok/Reels
OUTPUT_FPS: float = 30.0

# Clip boundary snapping options
SNAP_TO_SILENCE = True
SNAP_TO_DIALOG = True
SNAP_TO_SENTENCE = True

# Toggle LLM usage for transcript segmentation
USE_LLM_FOR_SEGMENTS = False
# Maximum transcript length to allow LLM segment refinement
SEG_LLM_MAX_CHARS = 12_000
# Toggle LLM-based detection of dialog ranges
DETECT_DIALOG_WITH_LLM = False
MAX_LLM_CHARS = 24_000
LLM_API_TIMEOUT = 12000

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
WHISPER_MODEL = "tiny"

# ---------------------------------------
# Candidate selection heuristics
# ---------------------------------------
MIN_DURATION_SECONDS = 6.0
MAX_DURATION_SECONDS = 90.0
SWEET_SPOT_MIN_SECONDS = 8.0
SWEET_SPOT_MAX_SECONDS = 35.0

DEFAULT_MIN_RATING = 7.0
DEFAULT_MIN_WORDS = 0

FUNNY_MIN_RATING = 9.1
FUNNY_MIN_WORDS = 5

EDUCATIONAL_MIN_RATING = 7.0
EDUCATIONAL_MIN_WORDS = 8

INSPIRING_MIN_RATING = 7.0
INSPIRING_MIN_WORDS = 8

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

# Optional website link to append to video descriptions
INCLUDE_WEBSITE_LINK = True
WEBSITE_URL = "https://atropos-video.com"
# Platform-specific description length limits
YOUTUBE_DESC_LIMIT = 5000
TIKTOK_DESC_LIMIT = 2000

__all__ = [
    "CAPTION_FONT_SCALE",
    "CAPTION_MAX_LINES",
    "SNAP_TO_SILENCE",
    "SNAP_TO_DIALOG",
    "SNAP_TO_SENTENCE",
    "USE_LLM_FOR_SEGMENTS",
    "SEG_LLM_MAX_CHARS",
    "DETECT_DIALOG_WITH_LLM",
    "EXPORT_RAW_CLIPS",
    "RAW_LIMIT",
    "SILENCE_DETECTION_NOISE",
    "SILENCE_DETECTION_MIN_DURATION",
    "TRANSCRIPT_SOURCE",
    "WHISPER_MODEL",
    "MIN_DURATION_SECONDS",
    "MAX_DURATION_SECONDS",
    "SWEET_SPOT_MIN_SECONDS",
    "SWEET_SPOT_MAX_SECONDS",
    "DEFAULT_MIN_RATING",
    "DEFAULT_MIN_WORDS",
    "FUNNY_MIN_RATING",
    "FUNNY_MIN_WORDS",
    "EDUCATIONAL_MIN_RATING",
    "EDUCATIONAL_MIN_WORDS",
    "INSPIRING_MIN_RATING",
    "INSPIRING_MIN_WORDS",
    "FORCE_REBUILD",
    "FORCE_REBUILD_SEGMENTS",
    "FORCE_REBUILD_DIALOG",
    "WINDOW_SIZE_SECONDS",
    "WINDOW_OVERLAP_SECONDS",
    "WINDOW_CONTEXT_SECONDS",
    "RATING_MIN",
    "RATING_MAX",
    "MIN_EXTENSION_MARGIN",
    "CLEANUP_NON_SHORTS",
    "TOKENS_DIR",
    "YOUTUBE_PRIVACY",
    "YOUTUBE_CATEGORY_ID",
    "TIKTOK_PRIVACY_LEVEL",
    "TIKTOK_CHUNK_SIZE",
    "INCLUDE_WEBSITE_LINK",
    "WEBSITE_URL",
    "YOUTUBE_DESC_LIMIT",
    "TIKTOK_DESC_LIMIT",
]
