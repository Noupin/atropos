"""OAuth authentication for the TikTok Content Posting API."""

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

TOKEN_NAME = "tiktok"
SCOPES = "video.upload,video.publish"


def _get_code(auth_url: str, state: str) -> tuple[str, str]:
    holder: Dict[str, str] = {}

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:  # pragma: no cover - network callback
            params = urllib.parse.parse_qs(
                urllib.parse.urlparse(self.path).query
            )
            if params.get("state", [""])[0] != state:
                self.send_response(400)
                self.end_headers()
                return
            holder["code"] = params.get("code", [""])[0]
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

    while "code" not in holder:
        time.sleep(0.1)
    server.server_close()
    return holder["code"], redirect_uri


def authenticate(store: TokenStore, config: Dict[str, Any]) -> Dict[str, Any]:
    token = store.load(TOKEN_NAME)
    if token and token.get("expires_at", 0) > time.time():
        return token

    client_key = os.environ["TIKTOK_CLIENT_KEY"]
    client_secret = os.environ["TIKTOK_CLIENT_SECRET"]
    state = uuid.uuid4().hex
    auth_url = (
        "https://www.tiktok.com/v2/auth/authorize/?response_type=code"
        f"&client_key={client_key}&scope={urllib.parse.quote(SCOPES)}"
        f"&state={state}&redirect_uri="
    )
    code, redirect_uri = _get_code(auth_url, state)

    resp = requests.post(
        "https://open.tiktokapis.com/v2/oauth/token/",
        data={
            "client_key": client_key,
            "client_secret": client_secret,
            "code": code,
            "grant_type": "authorization_code",
            "redirect_uri": redirect_uri,
        },
        timeout=30,
    )
    resp.raise_for_status()
    data = resp.json()["data"]
    token = {
        "access_token": data["access_token"],
        "expires_at": time.time() + data.get("expires_in", 3600),
        "refresh_token": data.get("refresh_token"),
    }
    store.save(TOKEN_NAME, token)
    return token


__all__ = ["authenticate"]
