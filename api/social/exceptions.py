from __future__ import annotations


class UnsupportedPlatformError(ValueError):
    """Raised when the caller requests an unsupported social platform."""
