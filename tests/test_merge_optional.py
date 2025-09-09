from server.interfaces.clip_candidate import ClipCandidate
from server.steps.candidates.helpers import _merge_adjacent_candidates


def test_merge_overlaps_flag_controls_behavior():
    items = [(0.0, 1.0, "a"), (1.0, 2.0, "b")]
    c1 = ClipCandidate(start=0.0, end=1.0, rating=5, reason="", quote="")
    c2 = ClipCandidate(start=1.0, end=2.0, rating=6, reason="", quote="")

    without_merge = _merge_adjacent_candidates(
        [c1, c2], items, merge_overlaps=False
    )
    assert len(without_merge) == 2

    with_merge = _merge_adjacent_candidates(
        [c1, c2], items, merge_overlaps=True
    )
    assert len(with_merge) == 1
    assert with_merge[0].start == 0.0 and with_merge[0].end == 2.0
    assert with_merge[0].rating == 6
