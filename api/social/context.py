from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Callable, Dict, Optional

from requests import Response, Session


@dataclass
class AttemptResult:
    response: Optional[Response]
    text: Optional[str]
    status: str
    elapsed: float
    error: Optional[str] = None


@dataclass
class PlatformContext:
    session: Session
    logger: logging.Logger
    request: Callable[[str, str, str, str, Optional[Dict[str, str]]], AttemptResult]
    fetch_text: Callable[[str, str, str], AttemptResult]
    now: Callable[[], float]
    instagram_web_app_id: str
