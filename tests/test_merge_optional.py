from server.interfaces.clip_candidate import ClipCandidate
from server.steps.candidates.helpers import (
    _enforce_non_overlap,
    _merge_adjacent_candidates,
)


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


def test_merged_clip_gets_resnapped():
    items = [
        (0.0, 1.0, "Hello"),
        (1.0, 2.0, "there"),
        (2.0, 3.0, "friend"),
    ]
    c1 = ClipCandidate(start=0.1, end=0.9, rating=5, reason="", quote="")
    c2 = ClipCandidate(start=1.1, end=1.9, rating=6, reason="", quote="")

    merged = _merge_adjacent_candidates([c1, c2], items, merge_overlaps=True)
    assert len(merged) == 1
    assert merged[0].start == 0.0
    assert merged[0].end == 3.0


def test_merge_uses_unsnapped_duration_check():
    items = [
        (0.0, 2.0, "A"),
        (3.0, 6.0, "B"),
    ]
    c1 = ClipCandidate(start=0.5, end=1.5, rating=5, reason="", quote="")
    c2 = ClipCandidate(start=3.5, end=4.5, rating=6, reason="", quote="")

    merged = _merge_adjacent_candidates(
        [c1, c2], items, merge_overlaps=True, max_duration_seconds=5.0
    )
    assert len(merged) == 1
    assert merged[0].start == 0.0
    assert merged[0].end == 5.0


def test_merge_exceeding_max_duration_clamps():
    items = [
        (0.0, 4.0, "A"),
        (4.0, 8.0, "B"),
    ]
    c1 = ClipCandidate(start=0.0, end=4.0, rating=5, reason="", quote="")
    c2 = ClipCandidate(start=4.1, end=8.0, rating=6, reason="", quote="")

    merged = _merge_adjacent_candidates(
        [c1, c2], items, merge_overlaps=True, max_duration_seconds=5.0
    )
    assert len(merged) == 1
    assert merged[0].start == 0.0
    assert merged[0].end == 5.0
    assert merged[0].rating == 6

def test_unsnapped_combo_exceeds_but_resnapped_fits_clamps_to_max():
    items = [
        (0.0, 2.0, "A"),
        (2.1, 7.0, "B"),
    ]
    silences = [
        (0.0, 0.1),
        (2.0, 2.1),
        (5.45, 10.0),
    ]
    c1 = ClipCandidate(start=0.0, end=2.0, rating=5, reason="", quote="")
    c2 = ClipCandidate(start=2.2, end=7.0, rating=6, reason="", quote="")

    merged = _merge_adjacent_candidates(
        [c1, c2],
        items,
        merge_overlaps=True,
        max_duration_seconds=5.0,
        silences=silences,
    )
    assert len(merged) == 1
    clip = merged[0]
    assert clip.start == 0.0
    assert clip.end == 5.0


def test_top_candidates_collapse_after_final_merge():
    items = [
        (0.0, 1.0, "A"),
        (1.2, 2.2, "B"),
    ]
    c1 = ClipCandidate(start=0.0, end=1.0, rating=5, reason="", quote="")
    c2 = ClipCandidate(start=1.2, end=2.2, rating=6, reason="", quote="")

    top = _enforce_non_overlap(
        [c1, c2],
        items,
        min_duration_seconds=0.1,
        min_rating=0.0,
    )
    assert len(top) == 2

    merged = _merge_adjacent_candidates(
        top,
        items,
        merge_overlaps=True,
        merge_gap_seconds=0.5,
    )
    assert len(merged) == 1
    clip = merged[0]
    assert clip.start == 0.0
    assert clip.end == 2.2
