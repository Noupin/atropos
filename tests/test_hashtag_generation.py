
from common.caption_utils import build_hashtag_prompt, prepare_hashtags


def test_prepare_hashtags_sanitizes_and_sorts():
    tags = ["Long Tag", "short", "punctuation!"]
    result = prepare_hashtags(tags, "The Show")
    assert result == ["#short", "#LongTag", "#TheShow", "#punctuation"]


def test_prepare_hashtags_dedupes_and_adds_show():
    tags = ["repeat", "repeat", "Another"]
    result = prepare_hashtags(tags, "repeat")
    assert result == ["#repeat", "#Another"]


def test_prepare_hashtags_handles_generic_tags():
    tags = ["Specific"]
    generics = ["foryou", "fyp", "viral", "trending"]
    result = prepare_hashtags(tags + generics, None)
    for expected in ["#foryou", "#fyp", "#viral", "#trending", "#Specific"]:
        assert expected in result


def test_build_hashtag_prompt_includes_guidelines():
    prompt = build_hashtag_prompt("Title", quote="Quote", show="Show")
    assert "plain text" in prompt
    assert "No profanity" in prompt
    assert "Strict JSON" in prompt
    assert "Show: Show" in prompt
