"""Unit tests for pipeline logging helpers."""

from __future__ import annotations

from typing import List

import pytest

from interfaces.progress import PipelineEvent, PipelineEventType, PipelineObserver
from helpers.logging import run_step


class _Recorder(PipelineObserver):
    """Collects events for assertions in tests."""

    def __init__(self) -> None:
        self.events: List[PipelineEvent] = []

    def handle_event(self, event: PipelineEvent) -> None:
        self.events.append(event)


def test_run_step_emits_start_and_completion() -> None:
    recorder = _Recorder()

    def _noop() -> str:
        return "ok"

    result = run_step("Test", _noop, step_id="test", observer=recorder)

    assert result == "ok"
    assert [event.type for event in recorder.events] == [
        PipelineEventType.STEP_STARTED,
        PipelineEventType.STEP_COMPLETED,
    ]


def test_run_step_emits_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    recorder = _Recorder()
    monkeypatch.setattr("helpers.logging.send_failure_email", lambda *args, **kwargs: None)

    def _boom() -> None:
        raise RuntimeError("boom")

    with pytest.raises(RuntimeError):
        run_step("Test", _boom, step_id="test", observer=recorder)

    assert [event.type for event in recorder.events] == [
        PipelineEventType.STEP_STARTED,
        PipelineEventType.STEP_FAILED,
    ]
