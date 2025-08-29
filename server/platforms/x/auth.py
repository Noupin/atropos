"""OAuth1.0a authentication for X (Twitter)."""

from __future__ import annotations

import os
import threading
import time
import urllib.parse
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import Any, Dict

from requests_oauthlib import OAuth1Session

from common.token_store import TokenStore

TOKEN_NAME = "x"


def _get_verifier(consumer_key: str, consumer_secret: str) -> tuple[str, str, str]:
    oauth = OAuth1Session(consumer_key, client_secret=consumer_secret)
    request_token_url = "https://api.twitter.com/oauth/request_token"
    fetch_response = oauth.fetch_request_token(request_token_url)
    resource_owner_key = fetch_response["oauth_token"]
    resource_owner_secret = fetch_response["oauth_token_secret"]

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:  # pragma: no cover - network callback
            params = urllib.parse.parse_qs(
                urllib.parse.urlparse(self.path).query
            )
            verifier = params.get("oauth_verifier", [""])[0]
            oauth_response["verifier"] = verifier
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b"Authentication complete. You may close this window.")

        def log_message(self, *_: Any) -> None:  # pragma: no cover - silence
            return

    oauth_response: Dict[str, str] = {}
    server = HTTPServer(("localhost", 0), Handler)
    port = server.server_port
    threading.Thread(target=server.handle_request, daemon=True).start()
    callback_uri = f"http://localhost:{port}/"
    oauth = OAuth1Session(
        consumer_key,
        client_secret=consumer_secret,
        resource_owner_key=resource_owner_key,
        resource_owner_secret=resource_owner_secret,
        callback_uri=callback_uri,
    )
    authorization_url = oauth.authorization_url(
        "https://api.twitter.com/oauth/authorize"
    )
    import webbrowser

    webbrowser.open(authorization_url)
    while "verifier" not in oauth_response:
        time.sleep(0.1)
    server.server_close()
    oauth_response.update({
        "resource_owner_key": resource_owner_key,
        "resource_owner_secret": resource_owner_secret,
    })
    return (
        oauth_response["verifier"],
        resource_owner_key,
        resource_owner_secret,
    )


def authenticate(store: TokenStore, config: Dict[str, Any]) -> Dict[str, Any]:
    token = store.load(TOKEN_NAME)
    if token:
        return token

    consumer_key = os.environ["X_CONSUMER_KEY"]
    consumer_secret = os.environ["X_CONSUMER_SECRET"]
    verifier, resource_owner_key, resource_owner_secret = _get_verifier(
        consumer_key, consumer_secret
    )
    oauth = OAuth1Session(
        consumer_key,
        client_secret=consumer_secret,
        resource_owner_key=resource_owner_key,
        resource_owner_secret=resource_owner_secret,
        verifier=verifier,
    )
    tokens = oauth.fetch_access_token("https://api.twitter.com/oauth/access_token")
    tokens["expires_at"] = float("inf")
    store.save(TOKEN_NAME, tokens)
    return tokens


__all__ = ["authenticate"]
