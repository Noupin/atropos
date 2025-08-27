"""Tests for colored timing logs."""

from typing import Iterator

import pytest

from server.helpers import logging as log_helpers
from server.helpers.formatting import Fore


def _counter(vals: list[float]) -> Iterator[float]:
    for v in vals:
        yield v


def test_run_step_logs(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture
) -> None:
    """``run_step`` should print colored messages with elapsed time."""
    times = _counter([0.0, 1.0])
    monkeypatch.setattr(log_helpers.time, "perf_counter", lambda: next(times))

    def fn() -> str:
        return "ok"

    assert log_helpers.run_step("STEP", fn) == "ok"
    out = capsys.readouterr().out
    assert Fore.CYAN in out
    assert Fore.GREEN in out
    assert "completed" in out


def test_log_timing_context(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture
) -> None:
    """``log_timing`` should log start/end with colors."""
    times = _counter([0.0, 1.0])
    monkeypatch.setattr(log_helpers.time, "perf_counter", lambda: next(times))

    with log_helpers.log_timing("WORK"):
        pass

    out = capsys.readouterr().out
    assert Fore.CYAN in out
    assert Fore.GREEN in out
    assert "completed" in out
