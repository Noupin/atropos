from __future__ import annotations
"""YouTube auth helper (single account).

- Stores credentials for ONE account in ``server/tokens/youtube.json``
- Desktop OAuth (InstalledAppFlow.run_local_server)
- Refreshes & persists tokens automatically.

Usage (bootstrap tokens):
    YT_CLIENT_SECRETS=yt_client_secret.json \
    python server/integrations/youtube/auth.py

In code:
    from server.integrations.youtube.auth import ensure_creds, build_service
    creds = ensure_creds()
    yt = build_service()
"""

import json
import os
from pathlib import Path
from typing import Optional, Dict, Any

from google_auth_oauthlib.flow import InstalledAppFlow
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build

# --- Constants (edit here, no argparse) --------------------------------------
SCOPES = ["https://www.googleapis.com/auth/youtube.upload"]
CLIENT_SECRETS_FILE = os.getenv("YT_CLIENT_SECRETS", "yt_client_secret.json")
TOKENS_FILE = Path(
    os.getenv("YT_TOKENS_FILE")
    or Path(__file__).resolve().parents[2] / "tokens" / "youtube.json"
)


# --- Token helpers ------------------------------------------------------------

def _load_token_json() -> Optional[Dict[str, Any]]:
    if TOKENS_FILE.exists():
        try:
            return json.loads(TOKENS_FILE.read_text(encoding="utf-8"))
        except Exception:
            return None
    return None


def _save_token_json(creds: Credentials) -> None:
    TOKENS_FILE.write_text(creds.to_json(), encoding="utf-8")


# --- Credential helpers -------------------------------------------------------

def load_creds() -> Optional[Credentials]:
    """Load creds from disk and refresh if needed; returns None if missing/invalid."""
    tok = _load_token_json()
    if not tok:
        return None
    creds = Credentials.from_authorized_user_info(tok, SCOPES)
    if creds and creds.valid:
        return creds
    if creds and creds.expired and creds.refresh_token:
        creds.refresh(Request())
        _save_token_json(creds)
        return creds
    return None


def refresh_creds() -> bool:
    """Attempt to load and refresh credentials without user interaction.

    Returns ``True`` if valid credentials are available, ``False`` otherwise.
    """
    try:
        return load_creds() is not None
    except Exception:
        return False


def ensure_creds() -> Credentials:
    """Ensure we have valid credentials saved to .youtube_tokens.json.
    Opens a browser on first-time auth; then refreshes silently next runs.
    """
    # Guard: client secrets must exist
    cs = Path(CLIENT_SECRETS_FILE)
    if not cs.exists():
        raise FileNotFoundError(
            f"CLIENT_SECRETS_FILE not found: {cs}. Set YT_CLIENT_SECRETS or place the file there."
        )

    creds = load_creds()
    if creds:
        return creds

    flow = InstalledAppFlow.from_client_secrets_file(CLIENT_SECRETS_FILE, SCOPES)
    creds = flow.run_local_server(port=0)
    _save_token_json(creds)
    return creds


def build_service():
    """Return an authenticated YouTube Data API v3 service for the single account."""
    creds = ensure_creds()
    return build("youtube", "v3", credentials=creds)


# --- When run directly: perform auth and save --------------------------------
if __name__ == "__main__":
    print("YouTube auth bootstrap (single account)")
    print(f"Client secrets: {CLIENT_SECRETS_FILE}")
    creds = ensure_creds()
    print(f"✅ Saved credentials to: {TOKENS_FILE}")
