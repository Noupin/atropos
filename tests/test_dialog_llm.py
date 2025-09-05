from __future__ import annotations

from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "server"))

import server.steps.dialog as dialog_pkg
from server.steps.dialog import detect_dialog_ranges


def _make_transcript(path: Path) -> None:
    path.write_text(
        """\
[0.0 -> 1.0] Hello.
[1.0 -> 2.0] This is funny haha!
[2.1 -> 3.0] Are you serious?
[4.0 -> 5.0] Another statement.
""".strip()
    )


def test_detect_dialog_ranges_with_llm(monkeypatch, tmp_path: Path) -> None:
    transcript = tmp_path / "sample.txt"
    _make_transcript(transcript)

    def fake_llm(model, prompt, options=None, timeout=None):
        return [
            {"start": 0.0, "end": 1.0},
            {"start": 4.0, "end": 5.0},
        ]

    monkeypatch.setattr(dialog_pkg, "local_llm_call_json", fake_llm)
    monkeypatch.setattr(dialog_pkg.config, "DETECT_DIALOG_WITH_LLM", True)

    ranges = detect_dialog_ranges(str(transcript))
    assert ranges == [(0.0, 1.0), (4.0, 5.0)]


def test_detect_dialog_ranges_llm_fallback(monkeypatch, tmp_path: Path) -> None:
    transcript = tmp_path / "sample.txt"
    _make_transcript(transcript)

    def fake_llm(model, prompt, options=None, timeout=None):
        raise RuntimeError("boom")

    monkeypatch.setattr(dialog_pkg, "local_llm_call_json", fake_llm)
    monkeypatch.setattr(dialog_pkg.config, "DETECT_DIALOG_WITH_LLM", True)

    ranges = detect_dialog_ranges(str(transcript))
    assert ranges == [(1.0, 3.0)]


def test_detect_dialog_ranges_llm_respects_config(monkeypatch, tmp_path: Path) -> None:
    transcript = tmp_path / "sample.txt"
    _make_transcript(transcript)

    def fake_llm(model, prompt, options=None, timeout=None):  # pragma: no cover
        raise AssertionError("LLM should not be called")

    monkeypatch.setattr(dialog_pkg, "local_llm_call_json", fake_llm)
    monkeypatch.setattr(dialog_pkg.config, "DETECT_DIALOG_WITH_LLM", False)

    ranges = detect_dialog_ranges(str(transcript))
    assert ranges == [(1.0, 3.0)]
