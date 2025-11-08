from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Dict, Optional


@dataclass
class AccountStats:
    handle: str
    count: Optional[int]
    fetched_at: float
    source: str
    is_mock: bool = False
    error: Optional[str] = None
    from_cache: bool = False
    extra: Optional[Dict[str, object]] = None

    def to_dict(self) -> Dict[str, object]:
        return {
            "handle": self.handle,
            "count": self.count,
            "fetched_at": datetime.fromtimestamp(
                self.fetched_at, tz=timezone.utc
            ).isoformat(),
            "source": self.source,
            "is_mock": self.is_mock,
            "error": self.error,
            "from_cache": self.from_cache,
            "extra": dict(self.extra) if isinstance(self.extra, dict) else None,
        }
