from __future__ import annotations

import builtins
import logging
import sys
from pathlib import Path
from types import SimpleNamespace
from typing import Dict

sys.path.append(str(Path(__file__).resolve().parents[1]))

import pytest

from api.social.platforms import instagram
from api.social.context import PlatformContext


class _DummyResponse:
    def __init__(self, body: str) -> None:
        self.text = body
        self.ok = True


class _DummyScraper:
    def __init__(self, responses: Dict[str, str]) -> None:
        self._responses = responses
        self.called_urls: list[str] = []

    def get(self, url: str, headers: Dict[str, str] | None = None) -> _DummyResponse:
        self.called_urls.append(url)
        body = self._responses.get(url, "")
        return _DummyResponse(body)


def _build_context() -> PlatformContext:
    return PlatformContext(
        session=None,
        logger=logging.getLogger("instagram-test"),
        request=lambda *args, **kwargs: None,
        fetch_text=lambda *args, **kwargs: None,
        now=lambda: 123.0,
        instagram_web_app_id="936619743392459",
    )


def test_cloudscraper_fallback_parses_json(monkeypatch: pytest.MonkeyPatch) -> None:
    payload = """
    {"data": {"user": {"edge_followed_by": {"count": 42}, "edge_owner_to_timeline_media": {"count": 7}}}}
    """

    dummy = _DummyScraper(
        {
            "https://www.instagram.com/api/v1/users/web_profile_info/?username=atropos": payload,
            "https://www.instagram.com/": "",
        }
    )

    monkeypatch.setitem(
        sys.modules,
        "cloudscraper",
        SimpleNamespace(create_scraper=lambda **kwargs: dummy),
    )

    stats = instagram._fetch_instagram_cloudscraper("atropos", "atropos", _build_context())
    assert stats is not None
    assert stats.count == 42
    assert stats.extra == {"posts": 7}


def test_cloudscraper_missing_module_returns_none(monkeypatch: pytest.MonkeyPatch) -> None:
    original_import = builtins.__import__

    def _raise_import(name: str, *args: object, **kwargs: object):
        if name == "cloudscraper":
            raise ImportError("mock missing cloudscraper")
        return original_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", _raise_import)
    monkeypatch.delitem(sys.modules, "cloudscraper", raising=False)
    stats = instagram._fetch_instagram_cloudscraper("atropos", "atropos", _build_context())
    assert stats is None
