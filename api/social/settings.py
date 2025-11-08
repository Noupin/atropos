from __future__ import annotations

import os

SCRAPER_TIMEOUT_SECONDS = float(os.environ.get("SCRAPER_TIMEOUT_SECONDS", "6"))
SCRAPER_RETRIES = int(os.environ.get("SCRAPER_RETRIES", "2"))
DEFAULT_CACHE_SECONDS = int(os.environ.get("SOCIAL_CACHE_SECONDS", "900"))
TEXT_PROXY_PREFIX = "https://r.jina.ai/"
INSTAGRAM_WEB_APP_ID = os.environ.get("INSTAGRAM_WEB_APP_ID", "936619743392459")
