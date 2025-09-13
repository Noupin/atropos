from server.interfaces.clip_candidate import ClipCandidate
from server.steps.candidates.helpers import _merge_adjacent_candidates


def test_merge_overlaps_flag_controls_behavior():
    items = [(0.0, 1.0, "a"), (1.0, 2.0, "b")]
    c1 = ClipCandidate(start=0.0, end=1.0, rating=5, reason="", quote="")
    c2 = ClipCandidate(start=1.0, end=2.0, rating=6, reason="", quote="")

    without_merge = _merge_adjacent_candidates(
        [c1, c2], merge_overlaps=False
    )
    assert len(without_merge) == 2

    with_merge = _merge_adjacent_candidates(
        [c1, c2], merge_overlaps=True
    )
    assert len(with_merge) == 1
    merged = with_merge[0]
    assert merged.start == 0.0 and merged.end == 2.0
    assert merged.rating == 5.5
    assert merged.count == 2


def test_merge_short_clips_reaches_sweet_spot() -> None:
    c1 = ClipCandidate(start=0.0, end=4.0, rating=5, reason="", quote="")
    c2 = ClipCandidate(start=4.0, end=8.0, rating=6, reason="", quote="")
    c3 = ClipCandidate(start=8.0, end=12.0, rating=7, reason="", quote="")
    merged = _merge_adjacent_candidates(
        [c1, c2, c3],
        merge_overlaps=True,
        min_duration_seconds=5.0,
        sweet_spot_min_seconds=10.0,
        sweet_spot_max_seconds=15.0,
    )
    assert len(merged) == 1
    m = merged[0]
    assert m.start == 0.0 and m.end == 12.0


def test_stop_merging_after_sweet_spot() -> None:
    c1 = ClipCandidate(start=0.0, end=4.0, rating=5, reason="", quote="")
    c2 = ClipCandidate(start=4.0, end=8.0, rating=6, reason="", quote="")
    c3 = ClipCandidate(start=8.0, end=12.0, rating=7, reason="", quote="")
    c4 = ClipCandidate(start=12.0, end=16.0, rating=8, reason="", quote="")
    merged = _merge_adjacent_candidates(
        [c1, c2, c3, c4],
        merge_overlaps=True,
        min_duration_seconds=5.0,
        sweet_spot_min_seconds=10.0,
        sweet_spot_max_seconds=15.0,
    )
    assert len(merged) == 2
    first, second = merged
    assert first.start == 0.0 and first.end == 12.0
    assert second.start == 12.0 and second.end == 16.0
