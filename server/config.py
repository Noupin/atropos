"""Central configuration for server pipeline and candidate processing.

Sections are grouped by feature for easier editing.
"""

import os
import platform
from pathlib import Path
from dataclasses import dataclass

from custom_types.ETone import Tone

# Logs
DEBUG_ENFORCE = False  # set True to see per-candidate enforce logs

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
# hex 1cbbff -> RGB(28,187,255) -> BGR(255,187,28)
CAPTION_FILL_BGR = (255, 187, 28)
CAPTION_OUTLINE_BGR = (236, 236, 236)  # hex ececec
# Constant frame-rate to avoid VFR issues on platforms like TikTok/Reels
OUTPUT_FPS: float = 30.0

# Name of the render layout to use. Options: "centered", "centered_with_corners", "no_zoom", "left_aligned"
RENDER_LAYOUT = os.environ.get("RENDER_LAYOUT", "centered")
VIDEO_ZOOM_RATIO = 0.4  # fraction of vertical space used by foreground video in centered layout

# Clip boundary snapping options
SNAP_TO_SILENCE = False
SNAP_TO_DIALOG = True
SNAP_TO_SENTENCE = True

# Toggle LLM usage for transcript segmentation
USE_LLM_FOR_SEGMENTS = True
# Toggle LLM-based detection of dialog ranges
DETECT_DIALOG_WITH_LLM = True

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
TRANSCRIPT_SOURCE = "whisper"
# Model used for faster-whisper transcription
WHISPER_MODEL = os.environ.get(
    "WHISPER_MODEL",
    "large-v3-turbo",  # (tiny, tiny.en, base, base.en, small, small.en, distil-small.en, medium, medium.en, distil-medium.en, large-v1, large-v2, large-v3, large, distil-large-v2, distil-large-v3, large-v3-turbo, or turbo)
)

# ---------------------------------------
# Clip selection
# ---------------------------------------
# Choose which type of clips to generate
CLIP_TYPE = Tone.FUNNY  # or "space", "history", "tech", "health"

# ---------------------------------------
# Candidate selection heuristics
# ---------------------------------------


@dataclass
class CandidateSelectionConfig:
    enforce_non_overlap: bool = True
    min_duration_seconds: float = 10.0
    max_duration_seconds: float = 85.0
    sweet_spot_min_seconds: float = 25.0
    sweet_spot_max_seconds: float = 60.0
    overlap_merge_percentage_requirement: float = 0.35
    default_min_rating: float = 9.0
    default_min_words: int = 0


CANDIDATE_SELECTION = CandidateSelectionConfig()

ENFORCE_NON_OVERLAP = CANDIDATE_SELECTION.enforce_non_overlap
MIN_DURATION_SECONDS = CANDIDATE_SELECTION.min_duration_seconds
MAX_DURATION_SECONDS = CANDIDATE_SELECTION.max_duration_seconds
SWEET_SPOT_MIN_SECONDS = CANDIDATE_SELECTION.sweet_spot_min_seconds
SWEET_SPOT_MAX_SECONDS = CANDIDATE_SELECTION.sweet_spot_max_seconds
OVERLAP_MERGE_PERCENTAGE_REQUIREMENT = (
    CANDIDATE_SELECTION.overlap_merge_percentage_requirement
)
DEFAULT_MIN_RATING = CANDIDATE_SELECTION.default_min_rating
DEFAULT_MIN_WORDS = CANDIDATE_SELECTION.default_min_words

# ---------------------------------------
# Pipeline and batching controls
# ---------------------------------------
# Whether to rebuild all cached artifacts
FORCE_REBUILD = False
# Fine-grained rebuild toggles
FORCE_REBUILD_SEGMENTS = False
FORCE_REBUILD_DIALOG = False
WINDOW_SIZE_SECONDS = 90.0
WINDOW_OVERLAP_SECONDS = 30.0
WINDOW_CONTEXT_PERCENTAGE = 0.11  # fraction of window length used as context on each side
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
CLEANUP_NON_SHORTS = os.environ.get("CLEANUP_NON_SHORTS", "false").lower() in ("1", "true", "yes", "y")

# ---------------------------------------
# Multi-platform upload settings
# ---------------------------------------
_tokens_dir_override = os.environ.get("ATROPOS_TOKENS_DIR")
if _tokens_dir_override:
    TOKENS_DIR = Path(_tokens_dir_override).expanduser().resolve()
else:
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

# Remove rendered clip assets after a successful manual upload
DELETE_UPLOADED_CLIPS = False

# ---------------------------------------
# Deprecated chunk-based LLM settings
# ---------------------------------------
# Legacy segmentation configuration slated for removal.
MAX_LLM_CHARS = 24_000
LLM_API_TIMEOUT = 600  # seconds
SEGMENT_OR_DIALOG_CHUNK_MAX_ITEMS = 100
LLM_MAX_WORKERS = 1
LLM_PER_CHUNK_TIMEOUT = 120  # seconds

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
    "EXPORT_RAW_CLIPS",
    "RAW_LIMIT",
    "SILENCE_DETECTION_NOISE",
    "SILENCE_DETECTION_MIN_DURATION",
    "TRANSCRIPT_SOURCE",
    "WHISPER_MODEL",
    "CLIP_TYPE",
    "ENFORCE_NON_OVERLAP",
    "MIN_DURATION_SECONDS",
    "MAX_DURATION_SECONDS",
    "SWEET_SPOT_MIN_SECONDS",
    "SWEET_SPOT_MAX_SECONDS",
    "OVERLAP_MERGE_PERCENTAGE_REQUIREMENT",
    "DEFAULT_MIN_RATING",
    "DEFAULT_MIN_WORDS",
    "CANDIDATE_SELECTION",
    "FORCE_REBUILD",
    "FORCE_REBUILD_SEGMENTS",
    "FORCE_REBUILD_DIALOG",
    "WINDOW_SIZE_SECONDS",
    "WINDOW_OVERLAP_SECONDS",
    "WINDOW_CONTEXT_PERCENTAGE",
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
    "INCLUDE_WEBSITE_LINK",
    "WEBSITE_URL",
    "YOUTUBE_DESC_LIMIT",
    "TIKTOK_DESC_LIMIT",
    "DELETE_UPLOADED_CLIPS",
    "MAX_LLM_CHARS",
    "LLM_API_TIMEOUT",
    "SEGMENT_OR_DIALOG_CHUNK_MAX_ITEMS",
    "LLM_MAX_WORKERS",
    "LLM_PER_CHUNK_TIMEOUT",
    "DEBUG_ENFORCE"
]
