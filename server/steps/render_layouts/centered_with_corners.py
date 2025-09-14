from __future__ import annotations

import cv2
import numpy as np

from .centered_zoom import CenteredZoomLayout


class CenteredWithCornersLayout(CenteredZoomLayout):
    """Centered layout that also shows enlarged bottom corners placed within the band above the foreground, with a configurable vertical bias."""

    def __init__(
        self,
        crop_ratio: float = 0.4,
        target_width_ratio: float = 0.47,
        margin_ratio: float = 0.02,
        vertical_bias: float = 0.15,
        bottom_corners_spacer_ratio: float = 0.0,
    ) -> None:
        self.crop_ratio = crop_ratio
        self.target_width_ratio = target_width_ratio
        self.margin_ratio = margin_ratio
        self.vertical_bias = vertical_bias
        self.bottom_corners_spacer_ratio = bottom_corners_spacer_ratio

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

        # Calculate spacer in pixels from the bottom
        spacer = int(h * self.bottom_corners_spacer_ratio)
        crop_start = max(0, h - crop_h - spacer)
        crop_end = crop_start + crop_h
        if crop_end > h:
            crop_end = h
            crop_start = max(0, crop_end - crop_h)
        bottom_left = frame[crop_start:crop_end, 0:crop_w]
        bottom_right = frame[crop_start:crop_end, w - crop_w : w]

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
            # Define the available vertical band: from top margin to just above the foreground box.
            band_top = margin
            band_bottom = max(band_top, fg_top - margin)
            band_height = max(0, band_bottom - band_top)

            if band_height >= target_h:
                # Place tiles within the band using a bias: 0.0 = stick to top, 0.5 = center, 1.0 = stick to bottom.
                bias = float(getattr(self, "vertical_bias", 0.33))
                bias = 0.0 if bias < 0.0 else (1.0 if bias > 1.0 else bias)
                y = band_top + int((band_height - target_h) * bias)
            else:
                # Not enough space to fully fit; clamp to top of the band.
                y = band_top
        else:
            half_height = canvas.shape[0] // 2
            band_top = margin
            band_bottom = max(band_top, half_height - margin)
            band_height = max(0, band_bottom - band_top)
            if band_height >= target_h:
                bias = float(getattr(self, "vertical_bias", 0.33))
                bias = 0.0 if bias < 0.0 else (1.0 if bias > 1.0 else bias)
                y = band_top + int((band_height - target_h) * bias)
            else:
                y = band_top

        left_x = margin
        right_x = canvas.shape[1] - target_w - margin

        canvas[y : y + target_h, left_x : left_x + target_w] = bl_resized
        canvas[y : y + target_h, right_x : right_x + target_w] = br_resized
        return canvas
