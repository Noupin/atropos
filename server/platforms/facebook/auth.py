"""Authentication for Facebook Pages using the Meta Graph API."""

from __future__ import annotations

import os
import threading
import time
import urllib.parse
import uuid
import webbrowser
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import Any, Dict

import requests

from ...common.token_store import TokenStore

TOKEN_NAME = "facebook"
OAUTH_SCOPES = (
    "pages_show_list,pages_read_engagement,pages_manage_posts"
)


def _get_oauth_code(auth_url: str, state: str) -> tuple[str, str]:
    """Run a local server to capture the OAuth ``code``."""

    code_holder: Dict[str, str] = {}

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:  # pragma: no cover - network callback
            params = urllib.parse.parse_qs(
                urllib.parse.urlparse(self.path).query
            )
            if params.get("state", [""])[0] != state:
                self.send_response(400)
                self.end_headers()
                return
            code_holder["code"] = params.get("code", [""])[0]
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b"Authentication complete. You may close this window.")

        def log_message(self, *_: Any) -> None:  # pragma: no cover - silence
            return

    server = HTTPServer(("localhost", 0), Handler)
    port = server.server_port
    threading.Thread(target=server.handle_request, daemon=True).start()
    redirect_uri = f"http://localhost:{port}/"
    webbrowser.open(auth_url + urllib.parse.quote(redirect_uri))

    while "code" not in code_holder:
        time.sleep(0.1)
    server.server_close()
    return code_holder["code"], redirect_uri


def authenticate(store: TokenStore, config: Dict[str, Any]) -> Dict[str, Any]:
    """Authenticate the user and return a long‑lived access token."""

    token = store.load(TOKEN_NAME)
    if token and token.get("expires_at", 0) > time.time():
        return token

    client_id = os.environ["META_CLIENT_ID"]
    client_secret = os.environ["META_CLIENT_SECRET"]
    state = uuid.uuid4().hex
    auth_url = (
        "https://www.facebook.com/v18.0/dialog/oauth?client_id="
        f"{client_id}&state={state}&scope={OAUTH_SCOPES}&redirect_uri="
    )
    code, redirect_uri = _get_oauth_code(auth_url, state)

    resp = requests.get(
        "https://graph.facebook.com/v18.0/oauth/access_token",
        params={
            "client_id": client_id,
            "client_secret": client_secret,
            "redirect_uri": redirect_uri,
            "code": code,
        },
        timeout=30,
    )
    resp.raise_for_status()
    short_token = resp.json()["access_token"]

    resp = requests.get(
        "https://graph.facebook.com/v18.0/oauth/access_token",
        params={
            "grant_type": "fb_exchange_token",
            "client_id": client_id,
            "client_secret": client_secret,
            "fb_exchange_token": short_token,
        },
        timeout=30,
    )
    resp.raise_for_status()
    data = resp.json()
    expires_in = data.get("expires_in", 60 * 60 * 24 * 60)
    token = {
        "access_token": data["access_token"],
        "expires_at": time.time() + expires_in,
    }
    store.save(TOKEN_NAME, token)
    return token


__all__ = ["authenticate"]


