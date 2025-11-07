from __future__ import annotations

from typing import Dict, List

import pathlib
import sys

import pytest

PROJECT_ROOT = pathlib.Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from api import social_pipeline as sp


@pytest.fixture(autouse=True)
def _reset_pipeline(monkeypatch):
    """Reset pipeline globals between tests."""

    sp._CACHE.clear()
    monkeypatch.setattr(sp, "ENABLE_SOCIAL_APIS", True)
    monkeypatch.setattr(sp, "ENABLE_SOCIAL_SCRAPER", True)
    monkeypatch.setattr(sp, "ENABLE_YT_API", True)

    handles: Dict[str, List[str]] = {"youtube": []}

    def get_handles() -> Dict[str, List[str]]:
        return handles

    monkeypatch.setattr(sp, "get_social_handles", get_handles)

    yield handles


def test_social_stats_prefers_api(monkeypatch, _reset_pipeline):
    handles = {"youtube": ["channelA", "channelB"]}
    monkeypatch.setattr(sp, "get_social_handles", lambda: handles)

    def api_fetcher(handle: str) -> int | None:
        return {"channelA": 120_000, "channelB": 80_000}.get(handle)

    def scrape_fetcher(handle: str) -> int | None:  # pragma: no cover - should not run
        raise AssertionError("Scraper should not be used when API succeeds")

    monkeypatch.setitem(sp.FETCHERS, "youtube", (api_fetcher, scrape_fetcher))

    stats = sp.get_social_stats("youtube")
    assert stats is not None
    assert stats.source == "api"
    assert stats.totals["count"] == 200_000
    assert all(not account.approximate for account in stats.per_account)


def test_social_stats_scrape_fallback(monkeypatch, _reset_pipeline):
    handles = {"youtube": ["channelA"]}
    monkeypatch.setattr(sp, "get_social_handles", lambda: handles)

    def api_fetcher(handle: str) -> int | None:
        return None

    def scrape_fetcher(handle: str) -> int | None:
        return 45_500

    monkeypatch.setitem(sp.FETCHERS, "youtube", (api_fetcher, scrape_fetcher))

    stats = sp.get_social_stats("youtube")
    assert stats is not None
    assert stats.source == "scrape"
    assert stats.totals["count"] == 45_500
    assert stats.per_account[0].approximate is True


def test_social_stats_missing_data(monkeypatch, _reset_pipeline):
    handles = {"youtube": ["channelA"]}
    monkeypatch.setattr(sp, "get_social_handles", lambda: handles)

    def api_fetcher(handle: str) -> int | None:
        return None

    def scrape_fetcher(handle: str) -> int | None:
        return None

    monkeypatch.setitem(sp.FETCHERS, "youtube", (api_fetcher, scrape_fetcher))

    stats = sp.get_social_stats("youtube")
    assert stats is not None
    assert stats.source == "none"
    assert stats.totals["count"] is None
    assert stats.per_account[0].count is None
