from __future__ import annotations

from .centered_zoom import CenteredZoomLayout


class LeftAlignedZoomLayout(CenteredZoomLayout):
    """Like the default layout but aligned to the left edge."""

    def x_position(self, fg_width: int, frame_width: int) -> int:
        return 0
