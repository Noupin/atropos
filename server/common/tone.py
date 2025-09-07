from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Callable, Tuple, List

from config import (
    FUNNY_MIN_RATING,
    INSPIRING_MIN_RATING,
    EDUCATIONAL_MIN_RATING,
)
from interfaces.clip_candidate import ClipCandidate
from steps.candidates.funny import find_funny_timestamps_batched
from steps.candidates.inspiring import find_inspiring_timestamps_batched
from steps.candidates.educational import find_educational_timestamps_batched


Finder = Callable[
    ..., Tuple[List[ClipCandidate], List[ClipCandidate], List[ClipCandidate]]
]


@dataclass(frozen=True)
class ToneSpec:
    """Configuration for a particular clip tone."""

    finder: Finder
    min_rating: float


class Tone(Enum):
    FUNNY = ToneSpec(find_funny_timestamps_batched, FUNNY_MIN_RATING)
    INSPIRING = ToneSpec(find_inspiring_timestamps_batched, INSPIRING_MIN_RATING)
    EDUCATIONAL = ToneSpec(find_educational_timestamps_batched, EDUCATIONAL_MIN_RATING)

