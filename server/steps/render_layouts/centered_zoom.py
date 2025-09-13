from __future__ import annotations

from .base import RenderLayout


class CenteredZoomLayout(RenderLayout):
    """Default layout: zoom to a fraction of frame height and center."""

    def scale_factor(
        self,
        width: int,
        height: int,
        frame_width: int,
        frame_height: int,
        fg_height_ratio: float,
    ) -> float:
        fg_target_h = max(100, int(frame_height * fg_height_ratio))
        return fg_target_h / height

    def x_position(self, fg_width: int, frame_width: int) -> int:
        return (frame_width - fg_width) // 2
