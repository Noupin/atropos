from __future__ import annotations

import cv2
import numpy as np

from .centered_zoom import CenteredZoomLayout


class CenteredWithCornersLayout(CenteredZoomLayout):
    """Centered layout that also shows enlarged bottom corners above the clip."""

    def __init__(
        self,
        crop_ratio: float = 0.4,
        target_width_ratio: float = 0.5,
        margin_ratio: float = 0.02,
    ) -> None:
        self.crop_ratio = crop_ratio
        self.target_width_ratio = target_width_ratio
        self.margin_ratio = margin_ratio

    def augment_canvas(
        self,
        canvas: np.ndarray,
        frame: np.ndarray,
        fg_box: tuple[int, int, int, int] | None = None,
    ) -> np.ndarray:
        h, w = frame.shape[:2]
        crop_w = int(w * self.crop_ratio)
        crop_h = int(h * self.crop_ratio)
        if crop_w == 0 or crop_h == 0:
            return canvas

        bottom_left = frame[h - crop_h : h, 0:crop_w]
        bottom_right = frame[h - crop_h : h, w - crop_w : w]

        target_w = int(canvas.shape[1] * self.target_width_ratio)
        if target_w == 0:
            return canvas
        scale = target_w / crop_w
        target_h = int(crop_h * scale)

        bl_resized = cv2.resize(bottom_left, (target_w, target_h))
        br_resized = cv2.resize(bottom_right, (target_w, target_h))

        margin = int(canvas.shape[1] * self.margin_ratio)

        if fg_box:
            fg_top = fg_box[1]
            y_center = fg_top / 2
            y = int(y_center - target_h / 2)
            y = max(margin, min(y, fg_top - target_h - margin))
        else:
            y = margin

        left_x = margin
        right_x = canvas.shape[1] - target_w - margin

        canvas[y : y + target_h, left_x : left_x + target_w] = bl_resized
        canvas[y : y + target_h, right_x : right_x + target_w] = br_resized
        return canvas
