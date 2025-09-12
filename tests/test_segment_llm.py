from __future__ import annotations

from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "server"))

import server.steps.segment as seg_pkg
from server.steps.segment import (
    segment_transcript_items,
    refine_segments_with_llm,
    maybe_refine_segments_with_llm,
)



def test_refine_segments_with_llm_merges(monkeypatch) -> None:
    items = [
        (0.0, 0.5, "Hello"),
        (0.5, 1.0, "world."),
        (1.0, 2.0, "This is test."),
    ]
    segments = segment_transcript_items(items)

    def fake_llm(model, prompt, options=None, timeout=None):
        return [
            {"start": 0.0, "end": 1.0, "text": "Hello world."},
            {"start": 1.0, "end": 2.0, "text": "This is test."},
        ]

    monkeypatch.setattr(seg_pkg, "local_llm_call_json", fake_llm)
    monkeypatch.setattr(seg_pkg, "local_llm_generate", lambda *a, **k: "pong")

    refined = refine_segments_with_llm(segments)
    assert refined == [
        (0.0, 1.0, "Hello world."),
        (1.0, 2.0, "This is test."),
    ]


def test_refine_segments_with_llm_fallback(monkeypatch) -> None:
    items = [
        (0.0, 1.0, "Hi."),
        (1.0, 2.0, "Bye."),
    ]
    segments = segment_transcript_items(items)

    def fake_llm(model, prompt, options=None, timeout=None):
        raise RuntimeError("boom")

    monkeypatch.setattr(seg_pkg, "local_llm_call_json", fake_llm)
    monkeypatch.setattr(seg_pkg, "local_llm_generate", lambda *a, **k: "pong")

    refined = refine_segments_with_llm(segments)
    assert refined == segments


def test_maybe_refine_segments_with_llm_respects_config(monkeypatch) -> None:
    items = [(0.0, 1.0, "Hello world.")]
    segments = segment_transcript_items(items)

    def fake_refine(seg, **kwargs):  # pragma: no cover - should not run
        raise AssertionError("refine_segments_with_llm should not be called")

    monkeypatch.setattr(seg_pkg, "refine_segments_with_llm", fake_refine)
    monkeypatch.setattr(seg_pkg.config, "USE_LLM_FOR_SEGMENTS", False)

    refined = maybe_refine_segments_with_llm(segments)
    assert refined == segments


def test_refine_segments_ping_accepts_non_json(monkeypatch) -> None:
    items = [(0.0, 1.0, "Hi.")]
    segments = segment_transcript_items(items)

    calls = {"ping": 0}

    def fake_ping(model, prompt, options=None, timeout=None):
        calls["ping"] += 1
        return "not json"

    def fake_llm(model, prompt, options=None, timeout=None):
        raise RuntimeError("boom")

    monkeypatch.setattr(seg_pkg, "local_llm_generate", fake_ping)
    monkeypatch.setattr(seg_pkg, "local_llm_call_json", fake_llm)

    refined = refine_segments_with_llm(segments)
    assert calls["ping"] == 1
    assert refined == segments
