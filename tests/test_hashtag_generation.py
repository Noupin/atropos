
from common.caption_utils import build_hashtag_prompt, prepare_hashtags


def test_prepare_hashtags_sanitizes_and_sorts():
    tags = ["Long Tag", "short", "punctuation!"]
    result = prepare_hashtags(tags, "The Show")
    assert result == ["#short", "#LongTag", "#TheShow", "#punctuation"]


def test_prepare_hashtags_dedupes_and_adds_show():
    tags = ["repeat", "repeat", "Another"]
    result = prepare_hashtags(tags, "repeat")
    assert result == ["#repeat", "#Another"]


def test_build_hashtag_prompt_includes_guidelines():
    prompt = build_hashtag_prompt("Title", quote="Quote", show="Show")
    assert "Favor short hashtags" in prompt
    assert "avoid punctuation" in prompt
    assert "Show: Show" in prompt
