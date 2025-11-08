from __future__ import annotations

import json
import logging
from pathlib import Path
import sys
from typing import Optional

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from api.social.context import PlatformContext
from api.social.models import AccountStats
from api.social.pipeline import SocialPipeline
from api.social.platforms import instagram, youtube


def _build_context() -> PlatformContext:
    logger = logging.getLogger("test-social")
    if not logger.handlers:
        logger.addHandler(logging.NullHandler())
    return PlatformContext(
        session=None,
        logger=logger,
        request=lambda *args, **kwargs: None,
        fetch_text=lambda *args, **kwargs: "",
        now=lambda: 0.0,
        instagram_web_app_id="",
    )


def test_instagram_next_data_parse() -> None:
    context = _build_context()
    payload = {
        "props": {
            "pageProps": {
                "legacyUserData": {
                    "edge_followed_by": {"count": 987654},
                    "edge_owner_to_timeline_media": {"count": 321},
                }
            }
        }
    }
    html = (
        "<html><body><script type=\"application/json\" id=\"__NEXT_DATA__\">"
        + json.dumps(payload)
        + "</script></body></html>"
    )
    count, posts, views, source = instagram._parse_instagram_html(  # type: ignore[attr-defined]
        html,
        "@atropos",
        "direct",
        "https://www.instagram.com/atropos/",
        context,
    )
    assert count == 987654
    assert posts == 321
    assert views is None
    assert source.endswith("next-data")


def test_instagram_regex_followers_parse() -> None:
    context = _build_context()
    html = "<div>We recently crossed <strong>12,500 followers</strong>.</div>"
    count, posts, views, source = instagram._parse_instagram_html(  # type: ignore[attr-defined]
        html,
        "@atropos",
        "text-proxy",
        "https://www.instagram.com/atropos/",
        context,
    )
    assert count == 12_500
    assert posts is None
    assert views is None
    assert source.endswith("regex")


def test_instagram_additional_data_parse() -> None:
    context = _build_context()
    payload = {
        "graphql": {
            "user": {
                "edge_followed_by": {"count": 43210},
                "edge_owner_to_timeline_media": {"count": 765},
            }
        }
    }
    html = (
        "<html><body><script>window.__additionalDataLoaded('/@atropos/', {data});"
        "</script></body></html>".replace("{data}", json.dumps(payload))
    )
    count, posts, views, source = instagram._parse_instagram_html(  # type: ignore[attr-defined]
        html,
        "@atropos",
        "direct",
        "https://www.instagram.com/atropos/",
        context,
    )
    assert count == 43_210
    assert posts == 765
    assert views is None
    assert source.endswith("additional-data")


def test_instagram_shared_data_parse() -> None:
    context = _build_context()
    payload = {
        "entry_data": {
            "ProfilePage": [
                {
                    "graphql": {
                        "user": {
                            "edge_followed_by": {"count": 32100},
                            "edge_owner_to_timeline_media": {"count": 654},
                        }
                    }
                }
            ]
        }
    }
    html = (
        "<html><body><script>window._sharedData = {data};" "</script></body></html>".replace(
            "{data}", json.dumps(payload)
        )
    )
    count, posts, views, source = instagram._parse_instagram_html(  # type: ignore[attr-defined]
        html,
        "@atropos",
        "direct",
        "https://www.instagram.com/atropos/",
        context,
    )
    assert count == 32_100
    assert posts == 654
    assert views is None
    assert source.endswith("shared-data")


def test_instagram_scrape_sends_app_id_header() -> None:
    captured_headers: list[Optional[dict[str, str]]] = []

    def fake_request(
        url: str,
        platform: str,
        handle: str,
        attempt: str,
        headers: Optional[dict[str, str]] = None,
    ) -> None:
        captured_headers.append(headers)
        return None

    context = PlatformContext(
        session=None,
        logger=logging.getLogger("test-instagram"),
        request=fake_request,
        fetch_text=lambda *args, **kwargs: "",
        now=lambda: 0.0,
        instagram_web_app_id="123456789",
    )

    instagram._fetch_instagram_scrape("@atropos", context)  # type: ignore[attr-defined]

    assert captured_headers, "expected request to be invoked"
    assert captured_headers[0] == {"X-IG-App-ID": "123456789"}


def test_youtube_additional_info_combined_counts() -> None:
    context = _build_context()
    html = """
    <html>
      <body>
        <div id="additional-info-container">
          <table>
            <tbody>
              <tr><td>Stats</td><td>62,000,004 views • 412 videos</td></tr>
            </tbody>
          </table>
        </div>
      </body>
    </html>
    """
    views, view_source, videos, video_source = youtube._parse_additional_info_counts(  # type: ignore[attr-defined]
        html,
        "atropos",
        "direct",
        context,
    )
    assert views == 62_000_004
    assert videos == 412
    assert view_source and view_source.endswith("additional-info")
    assert video_source and video_source.endswith("additional-info")


def test_youtube_html_includes_views_and_subscribers() -> None:
    context = _build_context()
    yt_initial = {
        "header": {
            "c4TabbedHeaderRenderer": {
                "subscriberCountText": {"simpleText": "1.5M subscribers"}
            }
        }
    }
    html = """
    <html>
      <body>
        <script>var ytInitialData = {data};</script>
        <div id="additional-info-container">
          <table>
            <tbody>
              <tr><td>Stats</td><td>191 videos</td></tr>
              <tr><td>Stats</td><td>12,345,678 views</td></tr>
            </tbody>
          </table>
        </div>
      </body>
    </html>
    """.replace("{data}", json.dumps(yt_initial))
    result = youtube._parse_youtube_html(  # type: ignore[attr-defined]
        html,
        "atropos",
        "direct",
        "https://www.youtube.com/@atropos/about",
        context,
    )
    assert result is not None
    assert result.subscribers == 1_500_000
    assert result.views == 12_345_678
    assert result.videos == 191
    assert result.count_source and result.count_source.endswith("ytInitialData")
    assert result.views_source and "additional-info" in result.views_source
    assert result.videos_source and "additional-info" in result.videos_source


def test_youtube_views_fallback_to_json_payload() -> None:
    context = _build_context()
    yt_initial = {
        "header": {
            "c4TabbedHeaderRenderer": {
                "subscriberCountText": {"simpleText": "2.3M subscribers"},
                "viewCountText": {"simpleText": "98765 total"},
                "videosCountText": {"simpleText": "432 videos"},
            }
        }
    }
    html = (
        "<html><body><script>var ytInitialData = {data};</script></body></html>".replace(
            "{data}", json.dumps(yt_initial)
        )
    )
    result = youtube._parse_youtube_html(  # type: ignore[attr-defined]
        html,
        "atropos",
        "direct",
        "https://www.youtube.com/@atropos/about",
        context,
    )
    assert result is not None
    assert result.subscribers == 2_300_000
    assert result.views == 98_765
    assert result.videos == 432
    assert result.views_source == "direct:ytInitialData"
    assert result.videos_source == "direct:ytInitialData"


def test_pipeline_totals_include_views(tmp_path: Path) -> None:
    pipeline = SocialPipeline(tmp_path)
    pipeline.config_path = tmp_path / "missing.json"
    pipeline._config = {"youtube": ["alpha", "beta"]}

    def fake_fetch(
        self: SocialPipeline, platform: str, handle: str
    ) -> AccountStats:
        views = {"alpha": 12345, "beta": None}[handle]
        videos = {"alpha": 321, "beta": None}[handle]
        extra = {}
        if views is not None:
            extra["views"] = views
        if videos is not None:
            extra["videos"] = videos
        extra = extra or None
        return AccountStats(
            handle=handle,
            count=1000,
            fetched_at=0.0,
            source="test",
            extra=extra,
        )

    pipeline._fetch_account = fake_fetch.__get__(pipeline, SocialPipeline)
    result = pipeline._gather_platform("youtube", ["alpha", "beta"])
    assert result["totals"]["views"] == 12345
    assert result["totals"]["views_accounts"] == 1
    assert result["totals"]["videos"] == 321
    assert result["totals"]["videos_accounts"] == 1


def test_overview_totals_accumulate_views(tmp_path: Path) -> None:
    pipeline = SocialPipeline(tmp_path)
    pipeline.config_path = tmp_path / "missing.json"
    pipeline._config = {"youtube": ["alpha"], "instagram": ["beta"]}

    def fake_fetch(
        self: SocialPipeline, platform: str, handle: str
    ) -> AccountStats:
        if platform == "youtube":
            extra = {"views": 4321, "videos": 210}
            count = 2000
        else:
            extra = None
            count = 1000
        return AccountStats(
            handle=handle,
            count=count,
            fetched_at=0.0,
            source="test",
            extra=extra,
        )

    pipeline._fetch_account = fake_fetch.__get__(pipeline, SocialPipeline)
    overview = pipeline.get_overview()
    assert overview["totals"]["views"] == 4321
    assert overview["totals"]["views_accounts"] == 1
    assert overview["totals"]["videos"] == 210
    assert overview["totals"]["videos_accounts"] == 1
