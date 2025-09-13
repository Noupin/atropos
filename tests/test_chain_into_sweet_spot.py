import pytest

from server.interfaces.clip_candidate import ClipCandidate
from server.steps.candidates.helpers import chain_into_sweet_spot
import server.config as cfg


def test_merge_when_gap_within_sweet_spot() -> None:
    a = ClipCandidate(start=0.0, end=10.0, rating=9.0, reason="a", quote="qa")
    b = ClipCandidate(start=30.0, end=40.0, rating=8.0, reason="b", quote="qb")
    result = chain_into_sweet_spot([a, b])
    assert len(result) == 1
    clip = result[0]
    assert clip.start == pytest.approx(0.0)
    assert clip.end == pytest.approx(40.0)
    assert clip.rating == 8.5
    assert clip.reason == "a | b"
    assert clip.quote == "qa | qb"


def test_not_merge_when_exceeds_sweet_spot_max() -> None:
    a = ClipCandidate(start=0.0, end=20.0, rating=9.0, reason="a", quote="qa")
    b = ClipCandidate(start=50.0, end=70.0, rating=9.0, reason="b", quote="qb")
    result = chain_into_sweet_spot([a, b])
    assert len(result) == 2
    assert result[0].start == pytest.approx(a.start)
    assert result[0].end == pytest.approx(a.end)
    assert result[1].start == pytest.approx(b.start)
    assert result[1].end == pytest.approx(b.end)


def test_forward_first_merge_stops_at_sweet_spot() -> None:
    c1 = ClipCandidate(0.0, 8.0, 9.0, "r1", "q1")
    c2 = ClipCandidate(8.4, 16.4, 8.0, "r2", "q2")
    c3 = ClipCandidate(16.8, 28.8, 7.0, "r3", "q3")
    result = chain_into_sweet_spot([c1, c2, c3])
    assert len(result) == 1
    clip = result[0]
    assert clip.start == pytest.approx(0.0)
    assert clip.end == pytest.approx(28.8)
    assert cfg.SWEET_SPOT_MIN_SECONDS <= clip.end - clip.start <= cfg.SWEET_SPOT_MAX_SECONDS
    assert clip.rating == 8.0
    assert clip.reason == "r1 | r2 | r3"
    assert clip.quote == "q1 | q2 | q3"
    assert cfg.MIN_DURATION_SECONDS <= clip.end - clip.start <= cfg.MAX_DURATION_SECONDS


def test_backward_merge_single_candidate() -> None:
    c1 = ClipCandidate(0.0, 10.0, 9.0, "r1", "q1")
    c2 = ClipCandidate(10.2, 19.2, 9.0, "r2", "q2")
    c3 = ClipCandidate(19.4, 27.4, 9.0, "r3", "q3")
    c4 = ClipCandidate(27.6, 30.6, 9.0, "r4", "q4")
    c5 = ClipCandidate(30.8, 33.8, 9.0, "r5", "q5")
    result = chain_into_sweet_spot([c1, c2, c3, c4, c5], min_duration_seconds=0)
    assert len(result) == 2
    first, second = result
    assert first.start == pytest.approx(0.0)
    assert first.end == pytest.approx(30.6)
    assert second.start == pytest.approx(30.8)
    assert second.end == pytest.approx(33.8)
    for clip in result:
        assert 0 <= clip.end - clip.start <= cfg.MAX_DURATION_SECONDS
