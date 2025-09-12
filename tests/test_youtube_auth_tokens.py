from __future__ import annotations

from pathlib import Path
import importlib
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server.integrations.youtube.auth as auth_module


def _reload_auth():
    """Reload the auth module to apply environment changes."""
    return importlib.reload(auth_module)


def test_tokens_file_defaults(monkeypatch) -> None:
    monkeypatch.delenv("YT_TOKENS_FILE", raising=False)
    monkeypatch.delenv("YT_ACCOUNT", raising=False)
    monkeypatch.delenv("ACCOUNT_NAME", raising=False)
    monkeypatch.delenv("ACCOUNT_KIND", raising=False)
    auth = _reload_auth()
    repo_root = Path(__file__).resolve().parents[1]
    assert auth.TOKENS_FILE == repo_root / "server" / "tokens" / "youtube.json"


def test_tokens_file_uses_account_env(monkeypatch) -> None:
    monkeypatch.setenv("ACCOUNT_NAME", "alt")
    monkeypatch.delenv("YT_TOKENS_FILE", raising=False)
    monkeypatch.delenv("YT_ACCOUNT", raising=False)
    monkeypatch.delenv("ACCOUNT_KIND", raising=False)
    auth = _reload_auth()
    repo_root = Path(__file__).resolve().parents[1]
    assert auth.TOKENS_FILE == repo_root / "server" / "tokens" / "alt" / "youtube.json"

