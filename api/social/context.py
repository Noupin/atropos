from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Callable, Dict, Optional

from requests import Response, Session


@dataclass
class PlatformContext:
    session: Session
    logger: logging.Logger
    request: Callable[[str, str, str, str, Optional[Dict[str, str]]], Optional[Response]]
    fetch_text: Callable[[str, str, str], Optional[str]]
    now: Callable[[], float]
    instagram_web_app_id: str
