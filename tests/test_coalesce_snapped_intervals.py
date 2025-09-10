from server.interfaces.clip_candidate import ClipCandidate
from server.steps.candidates.helpers import _coalesce_snapped_intervals


def test_coalesce_merges_touching():
    c1 = ClipCandidate(start=0.27, end=12.62, rating=9.5, reason="a", quote="q1")
    c2 = ClipCandidate(start=12.62, end=60.29, rating=9.2, reason="b", quote="q2")
    merged = _coalesce_snapped_intervals([c1, c2])
    assert len(merged) == 1
    m = merged[0]
    assert m.start == 0.27 and m.end == 60.29
    assert m.rating == 9.5 and m.reason == "a" and m.quote == "q1"


def test_coalesce_keeps_gap_over_eps():
    c1 = ClipCandidate(start=10.0, end=15.0, rating=5.0, reason="", quote="")
    c2 = ClipCandidate(start=15.002, end=20.0, rating=4.0, reason="", quote="")
    merged = _coalesce_snapped_intervals([c1, c2])
    assert len(merged) == 2


def test_coalesce_merges_within_eps():
    c1 = ClipCandidate(start=30.0, end=40.0, rating=5.0, reason="", quote="")
    c2 = ClipCandidate(start=39.9995, end=50.0, rating=6.0, reason="", quote="")
    merged = _coalesce_snapped_intervals([c1, c2])
    assert len(merged) == 1
    m = merged[0]
    assert m.start == 30.0 and m.end == 50.0 and m.rating == 6.0
