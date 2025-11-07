from __future__ import annotations

from types import SimpleNamespace
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


def test_youtube_scraper_handles_multiline_json(monkeypatch):
    html = """
    <script>
    var ytInitialData = {"subscriberCountText": {
        "runs": [
            {"text": "123K subscribers"}
        ]
    }};
    </script>
    """

    def fake_get(url, params=None, headers=None, allow_redirects=True):
        assert allow_redirects is True
        return SimpleNamespace(text=html)

    monkeypatch.setattr(sp, "_http_get", fake_get)

    count = sp._fetch_youtube_scrape("example")
    assert count == 123_000


def test_instagram_scraper_parses_meta_description(monkeypatch):
    html = (
        '<meta property="og:description" '
        'content="8,901 followers, 23 following, 114 posts" />'
    )

    def fake_get(url, params=None, headers=None, allow_redirects=True):
        if "web_profile_info" in url:
            raise RuntimeError("json disabled")
        return SimpleNamespace(text=html)

    monkeypatch.setattr(sp, "_http_get", fake_get)

    count = sp._fetch_instagram_scrape("example")
    assert count == 8_901


def test_instagram_scraper_prefers_json(monkeypatch):
    payload = {
        "data": {
            "user": {
                "edge_followed_by": {"count": 4321},
            }
        }
    }

    class DummyResponse:
        def json(self):
            return payload

    def fake_get(url, params=None, headers=None, allow_redirects=True):
        assert params == {"username": "example"}
        return DummyResponse()

    monkeypatch.setattr(sp, "_http_get", fake_get)

    count = sp._fetch_instagram_scrape("example")
    assert count == 4321


def test_http_get_respects_proxy_flag(monkeypatch):
    class DummyResponse:
        text = ""

        def raise_for_status(self):
            return None

    captured = {}

    class DummySession:
        def __init__(self):
            self.trust_env = True
            self.headers = {}

        def get(self, url, params=None, timeout=None, allow_redirects=True):
            captured["url"] = url
            captured["params"] = params
            captured["timeout"] = timeout
            captured["allow_redirects"] = allow_redirects
            captured["trust_env"] = self.trust_env
            return DummyResponse()

    monkeypatch.setattr(sp, "SCRAPER_RESPECT_PROXIES", False)
    monkeypatch.setattr(sp.requests, "Session", DummySession)

    response = sp._http_get("https://example.test")

    assert isinstance(response, DummyResponse)
    assert captured["url"] == "https://example.test"
    assert captured["timeout"] == sp.SCRAPER_TIMEOUT_SECONDS
    assert captured["allow_redirects"] is True
    # When the flag is False, the session should skip inherited proxy settings.
    assert captured["trust_env"] is False
