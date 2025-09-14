from __future__ import annotations

from .base import RenderLayout


class NoZoomLayout(RenderLayout):
    """Layout that preserves the original clip size."""

    def scale_factor(
        self,
        width: int,
        height: int,
        frame_width: int,
        frame_height: int,
        fg_height_ratio: float,
    ) -> float:
        # Do not upscale; scale down only if clip exceeds frame
        return min(1.0, frame_width / width, frame_height / height)

    def x_position(self, fg_width: int, frame_width: int) -> int:
        # Center the clip horizontally
        return (frame_width - fg_width) // 2
