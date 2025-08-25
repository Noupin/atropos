"""Dataclass representing a clip candidate segment."""

from dataclasses import dataclass


@dataclass
class ClipCandidate:
    start: float
    end: float
    rating: float
    reason: str
    quote: str

    def duration(self) -> float:
        return max(0.0, self.end - self.start)
