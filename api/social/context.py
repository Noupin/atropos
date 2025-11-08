from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Callable, Dict, Optional

from requests import Response, Session


@dataclass
class PlatformContext:
    session: Session
    logger: logging.Logger
    request: Callable[
        [str, str, str, str, Optional[Dict[str, str]]], "RequestOutcome"
    ]
    log_attempt: Callable[
        [str, str, "RequestOutcome", str, Optional[int], Optional[int], Optional[str]],
        None,
    ]
    now: Callable[[], float]
    instagram_web_app_id: str


@dataclass
class RequestOutcome:
    url: str
    attempt: str
    elapsed: float
    response: Optional[Response] = None
    status: Optional[int] = None
    error: Optional[str] = None
