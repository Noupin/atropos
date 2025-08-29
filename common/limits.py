"""Platform specific limits used by the uploader."""

PLATFORM_LIMITS = {
    "instagram": {"caption": 2200, "hashtags": 30},
    "facebook": {"caption": 5000, "hashtags": 30},
    "youtube": {"caption": 5000, "hashtags": 15},
    "tiktok": {"caption": 2200, "hashtags": 30},
    "snapchat": {"caption": 250, "hashtags": 10},
    "x": {"caption": 280, "hashtags": 10},
}

# Default handling for captions
TOP_N_HASHTAGS = 5
DEFAULT_HASHTAGS = ["#upload"]


__all__ = ["PLATFORM_LIMITS", "TOP_N_HASHTAGS", "DEFAULT_HASHTAGS"]

