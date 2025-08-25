"""Simple timing context manager dataclass."""

import time
from dataclasses import dataclass


@dataclass
class Timer:
    start_time: float = 0.0
    stop_time: float = 0.0

    def __enter__(self) -> "Timer":
        self.start_time = time.time()
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        self.stop_time = time.time()

    @property
    def elapsed(self) -> float:
        return self.stop_time - self.start_time
