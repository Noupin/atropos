"""Pipeline progress event interfaces for observers and broadcasters."""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
import time
from typing import Any, Protocol


class PipelineEventType(str, Enum):
    """Enumerates the different event categories emitted by the pipeline."""

    PIPELINE_STARTED = "pipeline_started"
    STEP_STARTED = "step_started"
    STEP_COMPLETED = "step_completed"
    STEP_FAILED = "step_failed"
    STEP_PROGRESS = "step_progress"
    CLIP_READY = "clip_ready"
    PIPELINE_COMPLETED = "pipeline_completed"
    LOG = "log"


@dataclass(slots=True)
class PipelineEvent:
    """Represents an event dispatched from the processing pipeline."""

    type: PipelineEventType
    message: str | None = None
    step: str | None = None
    data: dict[str, Any] | None = None
    timestamp: float = field(default_factory=time.time)

    def to_payload(self) -> dict[str, Any]:
        """Return a JSON-serialisable representation of the event."""

        payload: dict[str, Any] = {
            "type": self.type.value,
            "timestamp": self.timestamp,
        }
        if self.message is not None:
            payload["message"] = self.message
        if self.step is not None:
            payload["step"] = self.step
        if self.data:
            payload["data"] = self.data
        return payload


class PipelineObserver(Protocol):
    """Protocol for consumers interested in pipeline events."""

    def handle_event(self, event: PipelineEvent) -> None:
        """Handle a pipeline event dispatched by the processor."""
        raise NotImplementedError
