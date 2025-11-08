from __future__ import annotations

import time
from pathlib import Path
from typing import Iterable, Tuple

import pytest

from api.social.models import AccountStats
from api.social.pipeline import SocialPipeline, _extract_view_total


def test_extract_view_total_supports_variants() -> None:
    cases: Iterable[Tuple[dict, int]] = (
        ({"views": 123}, 123),
        ({"view_count": "456"}, 456),
        ({"statistics": {"viewCount": "789"}}, 789),
        ({"metrics": {"total_views": "1.2K"}}, 1_200),
        ({"plays": 333.4}, 333),
        ({"play_count": "12,345"}, 12_345),
    )
    for payload, expected in cases:
        assert _extract_view_total(payload) == expected

    assert _extract_view_total({}) is None
    assert _extract_view_total({"views": -10}) is None
    assert _extract_view_total({"views": False}) is None


def test_gather_platform_sums_view_totals(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    pipeline = SocialPipeline(data_dir=data_dir)

    now = time.time()
    stats_by_handle = {
        "one": AccountStats(
            handle="one",
            count=100,
            fetched_at=now,
            source="test",
            extra={"views": 100},
        ),
        "two": AccountStats(
            handle="two",
            count=200,
            fetched_at=now,
            source="test",
            extra={"view_count": "250"},
        ),
        "three": AccountStats(
            handle="three",
            count=300,
            fetched_at=now,
            source="test",
            extra={"metrics": {"total_views": "1.2K"}},
        ),
        "four": AccountStats(
            handle="four",
            count=400,
            fetched_at=now,
            source="test",
            extra={"views": -5},
        ),
    }

    def fake_fetch(platform: str, handle: str) -> AccountStats:
        return stats_by_handle[handle]

    monkeypatch.setattr(pipeline, "_fetch_account", fake_fetch)

    handles = list(stats_by_handle.keys())
    result = pipeline._gather_platform("youtube", handles)

    totals = result["totals"]
    assert totals["views"] == 100 + 250 + 1_200
    assert totals["views_accounts"] == 3

