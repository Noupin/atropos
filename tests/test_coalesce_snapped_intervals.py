from server.interfaces.clip_candidate import ClipCandidate
from server.steps.candidates.helpers import _coalesce_snapped_intervals


def test_coalesce_merges_touching():
    c1 = ClipCandidate(start=0.27, end=12.62, rating=9.5, reason="r1", quote="q1")
    c2 = ClipCandidate(start=12.62, end=60.29, rating=9.2, reason="r2", quote="q2")
    out = _coalesce_snapped_intervals([c1, c2])
    assert len(out) == 1
    merged = out[0]
    assert merged.start == 0.27 and merged.end == 60.29
    assert merged.rating == 9.5
    assert merged.reason == "r1"
    assert merged.quote == "q1"


def test_coalesce_gap_over_eps_not_merged():
    c1 = ClipCandidate(start=10.0, end=15.0, rating=5.0, reason="", quote="")
    c2 = ClipCandidate(start=15.001, end=20.0, rating=6.0, reason="", quote="")
    out = _coalesce_snapped_intervals([c1, c2])
    assert len(out) == 2


def test_coalesce_merges_within_eps():
    c1 = ClipCandidate(start=30.0, end=40.0, rating=5.0, reason="", quote="")
    c2 = ClipCandidate(start=40.0005, end=50.0, rating=6.0, reason="", quote="")
    out = _coalesce_snapped_intervals([c1, c2])
    assert len(out) == 1
    merged = out[0]
    assert merged.start == 30.0 and merged.end == 50.0
    assert merged.rating == 6.0

    out2 = _coalesce_snapped_intervals([c1, c2], eps=4e-4)
    assert len(out2) == 2
