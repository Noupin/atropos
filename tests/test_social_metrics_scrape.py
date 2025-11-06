from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import ANY, MagicMock, patch

import pytest


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from api.app import app


@pytest.fixture()
def client():
    app.config.update(TESTING=True)
    with app.test_client() as client:
        yield client


def _mock_response(text: str, status: int = 200):
    response = MagicMock()
    response.status_code = status
    response.text = text
    if status == 200:
        response.raise_for_status.return_value = None
    else:
        response.raise_for_status.side_effect = Exception("error")
    return response


def test_scrape_success_with_default_pattern(client):
    html = '<script type="application/ld+json">{"edge_followed_by":{"count":12345}}</script>'
    with patch("api.social_metrics.requests.get", return_value=_mock_response(html)) as mock_get:
        payload = {
            "platform": "instagram",
            "accounts": [{"url": "https://www.instagram.com/atropos/"}],
        }
        response = client.post("/social-metrics/scrape", json=payload)

    assert response.status_code == 200
    data = response.get_json()
    assert data["ok"] is True
    assert data["count"] == 12345
    assert data["accountCount"] == 1
    assert data["isMock"] is True
    mock_get.assert_called_once_with(
        "https://www.instagram.com/atropos/",
        headers=ANY,
        timeout=ANY,
    )


def test_scrape_failure_returns_502(client):
    html = "<html><body>No metrics here</body></html>"
    with patch("api.social_metrics.requests.get", return_value=_mock_response(html)):
        payload = {
            "platform": "youtube",
            "accounts": [
                {"url": "https://www.youtube.com/channel/UC123/about"},
                {"url": "https://www.youtube.com/channel/UC456/about"},
            ],
        }
        response = client.post("/social-metrics/scrape", json=payload)

    assert response.status_code == 502
    data = response.get_json()
    assert data["ok"] is False
    assert data["count"] is None
    assert data["accountCount"] == 0
    assert data["errors"]


def test_scrape_payload_validation(client):
    response = client.post("/social-metrics/scrape", json={"accounts": []})
    assert response.status_code == 400
    data = response.get_json()
    assert data["ok"] is False
    assert "platform" in data["error"].lower()


def test_scrape_includes_cors_headers_for_local_origin(client):
    html = "<html><body>Followers 1,234</body></html>"
    with patch("api.social_metrics.requests.get", return_value=_mock_response(html)):
        payload = {
            "platform": "youtube",
            "accounts": [{"url": "https://www.youtube.com/channel/UC123/about"}],
        }
        response = client.post(
            "/social-metrics/scrape",
            json=payload,
            headers={"Origin": "http://127.0.0.1:8000"},
        )

    assert response.status_code in (200, 502)
    assert response.headers["Access-Control-Allow-Origin"] == "http://127.0.0.1:8000"
    assert "POST" in response.headers["Access-Control-Allow-Methods"]
    assert "Content-Type" in response.headers["Access-Control-Allow-Headers"]


def test_scrape_options_request_returns_preflight_headers(client):
    response = client.options(
        "/social-metrics/scrape",
        headers={"Origin": "http://127.0.0.1:9000"},
    )

    assert response.status_code == 204
    assert response.headers["Access-Control-Allow-Origin"] == "http://127.0.0.1:9000"
    assert "OPTIONS" in response.headers["Access-Control-Allow-Methods"]


def test_scrape_omits_cors_headers_for_remote_origin(client):
    html = "<html><body>Followers 1,234</body></html>"
    with patch("api.social_metrics.requests.get", return_value=_mock_response(html)):
        payload = {
            "platform": "youtube",
            "accounts": [{"url": "https://www.youtube.com/channel/UC123/about"}],
        }
        response = client.post(
            "/social-metrics/scrape",
            json=payload,
            headers={"Origin": "https://atropos-video.com"},
        )

    assert "Access-Control-Allow-Origin" not in response.headers
