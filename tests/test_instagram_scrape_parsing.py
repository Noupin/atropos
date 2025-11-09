from __future__ import annotations

import json
import sys
from pathlib import Path
from types import SimpleNamespace

sys.path.append(str(Path(__file__).resolve().parents[1]))

from api.social.platforms import instagram


class _DummyLogger:
    def __init__(self) -> None:
        self.messages = []

    def info(self, *args, **kwargs) -> None:  # pragma: no cover - simple collector
        self.messages.append((args, kwargs))


def _make_context() -> SimpleNamespace:
    return SimpleNamespace(logger=_DummyLogger())


def test_parse_instagram_ld_json_accepts_additional_attributes() -> None:
    payload = """
    <html>
      <head></head>
      <body>
        <script type="application/ld+json" nonce="abc123" data-extra="1">
          {"interactionStatistic": [{"@type": "InteractionCounter", "name": "Followers", "userInteractionCount": "12,345"}]}
        </script>
      </body>
    </html>
    """
    count, posts, source = instagram._parse_instagram_payload(
        payload,
        handle="atropos",
        attempt="direct",
        url="https://www.instagram.com/atropos/",
        context=_make_context(),
    )
    assert count == 12345
    assert posts is None
    assert source.endswith("ld-json")


def test_parse_instagram_json_handles_string_counts() -> None:
    payload = json.dumps(
        {
            "data": {
                "user": {
                    "edge_owner_to_timeline_media": {"count": "987"},
                    "edge_followed_by": {"count": "654,321"},
                }
            }
        }
    )
    count, posts, source = instagram._parse_instagram_payload(
        payload,
        handle="atropos",
        attempt="json",
        url="https://www.instagram.com/api/v1/users/web_profile_info/?username=atropos",
        context=_make_context(),
    )
    assert count == 654321
    assert posts == 987
    assert source.endswith("edge_followed_by")


def test_parse_instagram_ld_json_allows_single_quotes() -> None:
    payload = """
    <script data-extra='yes' type='application/ld+json'>
      {"interactionStatistic": [{"@type": "InteractionCounter", "name": "Followers", "userInteractionCount": "777"}]}
    </script>
    """
    count, posts, source = instagram._parse_instagram_payload(
        payload,
        handle="atropos",
        attempt="html",
        url="https://www.instagram.com/atropos/",
        context=_make_context(),
    )
    assert count == 777
    assert posts is None
    assert source.endswith("ld-json")
