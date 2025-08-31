"""Central configuration for server pipeline and candidate processing.

Sections are grouped by feature for easier editing.
"""

# ---------------------------------------
# Rendering and clip boundary parameters
# ---------------------------------------
# Default baseline caption font scale for rendered videos
CAPTION_FONT_SCALE = 2.0

# Clip boundary snapping options
SNAP_TO_SILENCE = True
SNAP_TO_DIALOG = False
SNAP_TO_SENTENCE = True

# Export silence-only "raw" clips for debugging comparisons
EXPORT_RAW_CLIPS = False

# Silence detection thresholds
SILENCE_DETECTION_NOISE = "-30dB"
SILENCE_DETECTION_MIN_DURATION = 0.15

# ---------------------------------------
# Candidate selection heuristics
# ---------------------------------------
MIN_DURATION_SECONDS = 3.0
MAX_DURATION_SECONDS = 75.0
SWEET_SPOT_MIN_SECONDS = 5.0
SWEET_SPOT_MAX_SECONDS = 15.0

DEFAULT_MIN_RATING = 7.0
DEFAULT_MIN_WORDS = 0

FUNNY_MIN_RATING = 8.0
FUNNY_MIN_WORDS = 5

EDUCATIONAL_MIN_RATING = 7.0
EDUCATIONAL_MIN_WORDS = 8

INSPIRING_MIN_RATING = 7.0
INSPIRING_MIN_WORDS = 8

__all__ = [
    "CAPTION_FONT_SCALE",
    "SNAP_TO_SILENCE",
    "SNAP_TO_DIALOG",
    "SNAP_TO_SENTENCE",
    "EXPORT_RAW_CLIPS",
    "SILENCE_DETECTION_NOISE",
    "SILENCE_DETECTION_MIN_DURATION",
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
]
