from pathlib import Path
import sys


def test_find_candidates_uses_tqdm(monkeypatch, tmp_path: Path) -> None:
    """Ensure the candidate finder wraps windows with tqdm for progress reporting."""
    root = Path(__file__).resolve().parents[1]
    sys.path.insert(0, str(root))
    sys.path.insert(0, str(root / "server"))

    from server.steps.candidates import tone as tone_module

    transcript = tmp_path / "t.txt"
    transcript.write_text("[0.0 -> 1.0] hi\n")

    monkeypatch.setattr(tone_module, "parse_transcript", lambda _: [(0.0, 1.0, "hi")])
    windows = [(0.0, 1.0, []), (1.0, 2.0, [])]
    monkeypatch.setattr(tone_module, "_window_items", lambda _: windows)

    called: dict[str, int | str | None] = {}

    def fake_tqdm(iterable, *_, **kwargs):
        called["total"] = kwargs.get("total")
        called["desc"] = kwargs.get("desc")
        return iterable

    monkeypatch.setattr(tone_module, "tqdm", fake_tqdm)
    monkeypatch.setattr(
        "server.steps.candidates.local_llm_call_json", lambda **_: []
    )
    monkeypatch.setattr(
        "server.steps.candidates._filter_promotional_candidates", lambda c, _i: c
    )
    monkeypatch.setattr(
        "server.steps.candidates._merge_adjacent_candidates",
        lambda c, *_, **__: c,
    )
    monkeypatch.setattr(
        "server.steps.candidates._enforce_non_overlap",
        lambda c, _i, strategy, **__: c,
    )

    result = tone_module.find_candidates_by_tone(transcript, tone=tone_module.Tone.FUNNY)
    assert result == []
    assert called["total"] == len(windows)
