from __future__ import annotations

import json
import logging
from pathlib import Path
import sys

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
          <table><tbody><tr><td>Stats</td><td>12,345,678 views</td></tr></tbody></table>
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
    assert result.count_source and result.count_source.endswith("ytInitialData")
    assert result.views_source and "additional-info" in result.views_source


def test_pipeline_totals_include_views(tmp_path: Path) -> None:
    pipeline = SocialPipeline(tmp_path)
    pipeline.config_path = tmp_path / "missing.json"
    pipeline._config = {"youtube": ["alpha", "beta"]}

    def fake_fetch(
        self: SocialPipeline, platform: str, handle: str
    ) -> AccountStats:
        views = {"alpha": 12345, "beta": None}[handle]
        extra = {"views": views} if views is not None else None
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


def test_overview_totals_accumulate_views(tmp_path: Path) -> None:
    pipeline = SocialPipeline(tmp_path)
    pipeline.config_path = tmp_path / "missing.json"
    pipeline._config = {"youtube": ["alpha"], "instagram": ["beta"]}

    def fake_fetch(
        self: SocialPipeline, platform: str, handle: str
    ) -> AccountStats:
        if platform == "youtube":
            extra = {"views": 4321}
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
