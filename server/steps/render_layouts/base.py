from __future__ import annotations

from abc import ABC, abstractmethod


class RenderLayout(ABC):
    """Strategy for scaling and positioning the foreground clip."""

    @abstractmethod
    def scale_factor(
        self,
        width: int,
        height: int,
        frame_width: int,
        frame_height: int,
        fg_height_ratio: float,
    ) -> float:
        """Return scaling factor for the foreground clip."""

    @abstractmethod
    def x_position(self, fg_width: int, frame_width: int) -> int:
        """Return the X coordinate where the foreground should be placed."""
