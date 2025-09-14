
from common.caption_utils import (
    build_hashtag_prompt,
    coerce_hashtag_list,
    prepare_hashtags,
)
from helpers.hashtags import generate_hashtag_strings


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


def test_coerce_hashtag_list_extracts_strings():
    raw = [{"text": "CIA"}, {"tag": "files"}, "ancient", 7]
    assert coerce_hashtag_list(raw) == ["CIA", "files", "ancient", "7"]


def test_generate_hashtag_strings_parses_json(monkeypatch):
    def fake_call_json(*_args, **_kwargs):
        return [{"text": "cia"}, {"text": "files"}]

    monkeypatch.setattr("helpers.hashtags.local_llm_call_json", fake_call_json)
    tags = generate_hashtag_strings("Title")
    assert tags == ["cia", "files"]


def test_generate_hashtag_strings_fallback(monkeypatch):
    def bad_call_json(*_args, **_kwargs):
        raise ValueError("bad")

    def fake_generate(*_args, **_kwargs):
        return "cia files ancient"

    monkeypatch.setattr("helpers.hashtags.local_llm_call_json", bad_call_json)
    monkeypatch.setattr("helpers.hashtags.local_llm_generate", fake_generate)
    tags = generate_hashtag_strings("Title")
    assert tags == ["cia", "files", "ancient"]
