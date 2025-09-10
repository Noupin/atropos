from pathlib import Path
import sys
import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "server"))

from server.interfaces.clip_candidate import ClipCandidate
from server.steps.candidates.helpers import _final_merge_and_resnap


def test_final_merge_merges_using_originals(capsys) -> None:
    items = [(0.0, 4.0, "foo"), (5.5, 9.5, "bar")]
    snapped = [
        ClipCandidate(0.0, 4.0, 1.0, "a", ""),
        ClipCandidate(5.5, 9.5, 2.0, "b", ""),
    ]
    originals = [
        ClipCandidate(0.0, 5.0, 1.0, "", ""),
        ClipCandidate(4.0, 10.0, 2.0, "", ""),
    ]
    result = _final_merge_and_resnap(
        snapped,
        items,
        originals=originals,
        merge_gap_seconds=1.0,
        max_duration_seconds=20.0,
    )
    assert len(result) == 1
    assert result[0].start == pytest.approx(0.0)
    assert result[0].end == pytest.approx(9.5)
    output = capsys.readouterr().out
    assert "[FinalMerge] coalesced_at_start: 2->2" in output
    assert "[FinalMerge] coalesced_after_originals: 1->1" in output
