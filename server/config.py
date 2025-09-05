"""Central configuration for server pipeline and candidate processing.

Sections are grouped by feature for easier editing.
"""

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
SNAP_TO_DIALOG = False
SNAP_TO_SENTENCE = True

# Toggle LLM-based refinement of transcript segments
REFINE_SEGMENTS_WITH_LLM = True

# Export silence-only "raw" clips for debugging comparisons
EXPORT_RAW_CLIPS = False

# Silence detection thresholds
SILENCE_DETECTION_NOISE = "-30dB"
SILENCE_DETECTION_MIN_DURATION = 0.075

# ---------------------------------------
# Transcript acquisition settings
# ---------------------------------------
# Preferred transcript source: "youtube" or "whisper"
TRANSCRIPT_SOURCE = "whisper"

# ---------------------------------------
# Candidate selection heuristics
# ---------------------------------------
MIN_DURATION_SECONDS = 3.0
MAX_DURATION_SECONDS = 90.0
SWEET_SPOT_MIN_SECONDS = 5.0
SWEET_SPOT_MAX_SECONDS = 15.0

DEFAULT_MIN_RATING = 7.0
DEFAULT_MIN_WORDS = 0

FUNNY_MIN_RATING = 8.1
FUNNY_MIN_WORDS = 5

EDUCATIONAL_MIN_RATING = 7.0
EDUCATIONAL_MIN_WORDS = 8

INSPIRING_MIN_RATING = 7.0
INSPIRING_MIN_WORDS = 8

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

__all__ = [
    "CAPTION_FONT_SCALE",
    "CAPTION_MAX_LINES",
    "SNAP_TO_SILENCE",
    "SNAP_TO_DIALOG",
    "SNAP_TO_SENTENCE",
    "REFINE_SEGMENTS_WITH_LLM",
    "EXPORT_RAW_CLIPS",
    "SILENCE_DETECTION_NOISE",
    "SILENCE_DETECTION_MIN_DURATION",
    "TRANSCRIPT_SOURCE",
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
    "TOKENS_DIR",
    "YOUTUBE_PRIVACY",
    "YOUTUBE_CATEGORY_ID",
    "TIKTOK_PRIVACY_LEVEL",
    "TIKTOK_CHUNK_SIZE",
    "INCLUDE_WEBSITE_LINK",
    "WEBSITE_URL",
]
