"""Tests for the retry helper."""

from typing import List

import pytest

from server.helpers.ai import retry


def test_retry_succeeds(monkeypatch: pytest.MonkeyPatch) -> None:
    """Function should be retried until it succeeds."""
    attempts: List[int] = []

    def flaky() -> str:
        attempts.append(1)
        if len(attempts) < 3:
            raise ValueError("nope")
        return "ok"

    sleeps: List[float] = []
    monkeypatch.setattr("time.sleep", lambda s: sleeps.append(s))

    assert retry(flaky, attempts=5, backoff=2) == "ok"
    assert attempts == [1, 1, 1]
    assert sleeps == [1.0, 2.0]


def test_retry_raises(monkeypatch: pytest.MonkeyPatch) -> None:
    """After exhausting attempts, the last exception should be raised."""
    count = 0

    def always_fail() -> None:
        nonlocal count
        count += 1
        raise RuntimeError("boom")

    monkeypatch.setattr("time.sleep", lambda s: None)

    with pytest.raises(RuntimeError):
        retry(always_fail, attempts=3, backoff=1)
    assert count == 3
