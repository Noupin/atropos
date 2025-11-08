"""Regression coverage for Instagram scraping helpers."""

from __future__ import annotations

import importlib.util
import sys
import uuid
from pathlib import Path


def _load_social_pipeline_module():
    module_name = f"_social_pipeline_test_{uuid.uuid4().hex}"
    module_path = Path(__file__).resolve().parents[1] / "api" / "social_pipeline.py"
    spec = importlib.util.spec_from_file_location(module_name, module_path)
    if spec is None or spec.loader is None:
        raise RuntimeError("Unable to load social_pipeline module for testing")
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    sys.modules.pop(module_name, None)
    return module


def test_instagram_mobile_headers_respect_environment(monkeypatch):
    monkeypatch.setenv("INSTAGRAM_MOBILE_USER_AGENT", "Instagram 1.2.3 Android")
    module = _load_social_pipeline_module()

    headers = module._instagram_json_headers(mobile=True)

    assert headers["User-Agent"] == "Instagram 1.2.3 Android"
    assert headers["X-IG-App-ID"] == module.INSTAGRAM_WEB_APP_ID
    assert headers["X-ASBD-ID"] == module.INSTAGRAM_ASBD_ID


def test_instagram_scrape_attempts_mobile_json_headers(monkeypatch, tmp_path):
    module = _load_social_pipeline_module()
    pipeline = module.SocialPipeline(tmp_path)
    calls: list[tuple[str, str, dict | None]] = []

    class _FakeResponse:
        def __init__(self) -> None:
            self.ok = False
            self.text = ""

    def fake_request(url, platform, handle, attempt, headers=None):  # type: ignore[override]
        calls.append((attempt, url, headers))
        return _FakeResponse()

    monkeypatch.setattr(pipeline, "_request", fake_request)
    monkeypatch.setattr(pipeline, "_fetch_text", lambda *_, **__: "")

    result = pipeline._fetch_instagram_scrape("example")

    assert result.count is None
    assert len(calls) == 4
    first_attempt, _, first_headers = calls[0]
    second_attempt, _, second_headers = calls[1]
    assert first_attempt == "json-web"
    assert first_headers is not None
    assert first_headers["X-IG-App-ID"] == module.INSTAGRAM_WEB_APP_ID
    assert second_attempt == "json-mobile"
    assert second_headers is not None
    assert second_headers["User-Agent"].startswith("Instagram")
