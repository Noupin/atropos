from __future__ import annotations

import sys
from pathlib import Path

sys.path.append(str(Path(__file__).resolve().parents[1]))

from api.social.platforms.youtube import _parse_views_from_dom, _parse_views_from_regex


def test_parse_views_from_dom_matches_same_cell_views() -> None:
    html = """
    <div id="additional-info-container">
        <table><tbody><tr>
            <td><span>44,525 views</span></td>
        </tr></tbody></table>
    </div>
    """

    assert _parse_views_from_dom(html) == 44525


def test_parse_views_from_regex_returns_largest_match() -> None:
    html = """
    <div id="additional-info-container">
        <span>224 views</span>
        <span>44,525 views</span>
    </div>
    """

    assert _parse_views_from_regex(html) == 44525
