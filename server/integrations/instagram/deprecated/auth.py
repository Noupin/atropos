# integrations/meta/auth.py
# Single OAuth flow for Facebook Pages + Instagram Graph.
# Use: open login_url(), approve, capture "code", exchange -> long-lived user token,
# then page_tokens() and ig_user_id_from_page().

import os, urllib.parse, requests, hmac, hashlib, json, threading, time, webbrowser
from typing import Dict
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, HTTPServer

# ---------- CONFIG ----------
# NOTE: Do not commit real APP_SECRET to source control; prefer environment variables.
APP_ID       = os.getenv("META_APP_ID")
APP_SECRET   = os.getenv("META_APP_SECRET")
REDIRECT_URI = os.getenv("META_REDIRECT_URI", "http://localhost:3544")  # ok to use http://localhost:PORT during dev
SCOPES = [
    # Instagram Graph scopes (for IG) …
    "instagram_basic",
    "instagram_content_publish",
    # …and the one Page scope required to list your Pages so we can resolve the IG user id:
    # (Meta requires that IG Business/Creator be linked to a Facebook Page; we need the Page to fetch the IG id)
    "pages_show_list",
]
GRAPH = "https://graph.facebook.com/v19.0"
FACEBOOK_DIALOG = "https://www.facebook.com/v19.0/dialog/oauth"

# Where to persist tokens/debug info (mirrors your TikTok style)
TOKEN_STORE = os.getenv("META_TOKEN_STORE", ".meta_tokens.json")

# Required scopes for posting to FB Pages and IG Graph
REQUIRED_SCOPES = {
    "instagram_basic",
    "instagram_content_publish",
    "pages_show_list",
}

def _ensure_callback_path(uri: str) -> str:
    """Force a '/callback' path so our local server can capture the code."""
    pr = urllib.parse.urlparse(uri)
    if not pr.path or pr.path == "/":
        pr = pr._replace(path="/callback")
        return urllib.parse.urlunparse(pr)
    return uri

REDIRECT_URI = _ensure_callback_path(REDIRECT_URI)

def _appsecret_proof(token: str) -> str:
    """
    Meta recommends sending appsecret_proof with every Graph call made from your server.
    It's HMAC-SHA256(access_token, app_secret).
    """
    return hmac.new(APP_SECRET.encode("utf-8"), token.encode("utf-8"), hashlib.sha256).hexdigest()

def debug_token(token: str) -> Dict:
    """
    Inspect a token (user or page) to verify scopes, app, expiry, etc.
    Uses app access token: APP_ID|APP_SECRET
    """
    app_token = f"{APP_ID}|{APP_SECRET}"
    r = requests.get(f"{GRAPH}/debug_token", params={
        "input_token": token,
        "access_token": app_token,
    }, timeout=30)
    r.raise_for_status()
    return r.json()

def check_required_scopes(user_or_page_token: str):
    info = debug_token(user_or_page_token)
    scopes = set(info.get("data", {}).get("scopes", []))
    missing = sorted(REQUIRED_SCOPES - scopes)
    return scopes, missing

def _write_json(path: str, data: dict):
    with open(path, "w") as f:
        json.dump(data, f, indent=2, sort_keys=True)

def persist_meta_tokens(
    user_token: str,
    user_expires_in: int,
    pages_map: Dict[str, str],
    selected_page_id: str,
    selected_page_token: str,
    ig_user_id: str
):
    payload = {
        "saved_at": datetime.now(timezone.utc).isoformat(),
        "user_token": user_token,
        "user_token_expires_in": user_expires_in,
        "user_token_expires_at": (datetime.now(timezone.utc) + timedelta(seconds=user_expires_in)).isoformat(),
        "pages": pages_map,                     # {page_id: page_access_token}
        "selected_page_id": selected_page_id,   # str
        "selected_page_token": selected_page_token,
        "ig_user_id": ig_user_id
    }
    _write_json(TOKEN_STORE, payload)

def load_meta_tokens() -> dict:
    if not os.path.exists(TOKEN_STORE):
        return {}
    with open(TOKEN_STORE, "r") as f:
        return json.load(f)
# ---------------------------

class _OAuthHandler(BaseHTTPRequestHandler):
    authorization_code = None
    authorization_state = None
    error = None

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path != urllib.parse.urlparse(REDIRECT_URI).path:
            self.send_response(404); self.end_headers(); self.wfile.write(b"Not Found"); return
        qs = urllib.parse.parse_qs(parsed.query)
        _OAuthHandler.authorization_code = (qs.get("code") or [None])[0]
        _OAuthHandler.authorization_state = (qs.get("state") or [None])[0]
        _OAuthHandler.error = (qs.get("error") or [None])[0]
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b"<h1>Auth complete. You can close this window.</h1>")
        # Stop the server in a non-blocking way
        threading.Thread(target=self.server.shutdown, daemon=True).start()

def _start_local_server():
    pr = urllib.parse.urlparse(REDIRECT_URI)
    host = pr.hostname or "localhost"
    port = pr.port or 80
    httpd = HTTPServer((host, port), _OAuthHandler)
    httpd.serve_forever()

def run_local_oauth(state: str = "state", open_browser: bool = True, timeout_s: int = 300) -> str:
    """
    Spins up a local HTTP server to capture the OAuth redirect at REDIRECT_URI,
    opens the login URL, waits for ?code=..., then returns the code.
    """
    # Start local listener
    t = threading.Thread(target=_start_local_server, daemon=True)
    t.start()

    # Launch browser to login URL
    url = login_url(state=state)
    if open_browser:
        try:
            webbrowser.open(url)
        except Exception:
            pass
    print("Open this URL to authorize:\n", url)
    print(f"Listening on {REDIRECT_URI} for callback…")

    # Wait for code
    start = time.time()
    while _OAuthHandler.authorization_code is None and (time.time() - start) < timeout_s:
        time.sleep(0.1)

    if _OAuthHandler.error:
        raise RuntimeError(f"OAuth error: {_OAuthHandler.error}")
    if _OAuthHandler.authorization_code is None:
        raise TimeoutError("Timed out waiting for OAuth redirect.")
    return _OAuthHandler.authorization_code

def login_url(state: str = "state") -> str:
    q = urllib.parse.urlencode({
        "client_id": APP_ID,
        "redirect_uri": REDIRECT_URI,
        "response_type": "code",
        "scope": ",".join(SCOPES),
        "state": state,
        # auth_type=rerequest forces the dialog to show any newly added scopes (e.g., pages_show_list)
        "auth_type": "rerequest",
    })
    return f"{FACEBOOK_DIALOG}?{q}"

def exchange_code_for_token(code: str) -> Dict:
    s = requests.Session()
    r = s.get(f"{GRAPH}/oauth/access_token", params={
        "client_id": APP_ID,
        "redirect_uri": REDIRECT_URI,  # must exactly match login + app setting
        "client_secret": APP_SECRET,
        "code": code,
    }, timeout=30)
    if r.status_code >= 400:
        # show Graph error payload to pinpoint mismatch/expiry/etc.
        try:
            print("Graph error:", r.json())
        except Exception:
            print("Graph raw error:", r.text)
        r.raise_for_status()
    return r.json()

def long_lived_user_token(short_token: str) -> Dict:
    r = requests.get(f"{GRAPH}/oauth/access_token", params={
        "grant_type": "fb_exchange_token",
        "client_id": APP_ID,
        "client_secret": APP_SECRET,
        "fb_exchange_token": short_token,
    }, timeout=30)
    r.raise_for_status()
    return r.json()  # { access_token, token_type, expires_in }

def page_tokens(long_user_token: str) -> Dict[str, str]:
    """Return {page_id: page_access_token} for Pages the user manages."""
    r = requests.get(f"{GRAPH}/me/accounts", params={
        "access_token": long_user_token,
        "appsecret_proof": _appsecret_proof(long_user_token),
    }, timeout=30)
    r.raise_for_status()
    pages = r.json().get("data", [])
    return {p["id"]: p["access_token"] for p in pages}

# NOTE: Instagram Content Publishing via the official Graph API requires that the
# Instagram Business/Creator account be linked to a Facebook Page. Without a Page
# and the corresponding Page access token, you cannot publish via the IG Graph API.
def ig_user_id_from_page(page_id: str, page_token: str) -> str:
    """Get IG Business/Creator user id attached to a Page."""
    r = requests.get(f"{GRAPH}/{page_id}", params={
        "fields": "instagram_business_account,connected_instagram_account",
        "access_token": page_token,
        "appsecret_proof": _appsecret_proof(page_token),
    }, timeout=30)
    r.raise_for_status()
    data = r.json()
    ig = data.get("instagram_business_account") or data.get("connected_instagram_account")
    if not ig:
        raise RuntimeError("Page is not linked to an Instagram Business/Creator account (no IG account found on Page).")
    return ig["id"]

# Optional tiny helpers
def save_token(path: str, token: str): open(path, "w").write(token.strip())
def load_token(path: str) -> str: return open(path).read().strip()

if __name__ == "__main__":
    # Auto-capture the ?code=… via a temporary localhost server.
    code = run_local_oauth(state="meta-auth", open_browser=True, timeout_s=600)
    print("Received code.")

    short = exchange_code_for_token(code)
    long = long_lived_user_token(short["access_token"])
    user_token = long["access_token"]
    print("Long-lived user token:", user_token[:20] + "…")
    user_expires_in = int(long.get("expires_in", 0))

    # Persist immediately with user token so we always save something even if no Pages/IG ID
    persist_meta_tokens(
        user_token=user_token,
        user_expires_in=user_expires_in,
        pages_map={},                 # unknown yet
        selected_page_id="",          # none
        selected_page_token="",       # none
        ig_user_id=""                 # unknown yet
    )
    print(f"(Initial) Saved user token to: {TOKEN_STORE}")

    # Check scopes on the user token
    scopes, missing = check_required_scopes(user_token)
    print("User token scopes:", sorted(scopes))
    if missing:
        print("MISSING scopes on user token ->", missing)
        print("Re-run login_url() and re-grant permissions (dialog will 'rerequest').")

    pages = {}
    try:
        pages = page_tokens(user_token)
    except Exception as e:
        print("Warning: could not fetch Page tokens (you may not have FB Page perms):", e)

    print("Pages found:", list(pages.keys()))
    if not pages:
        print("No Pages returned by /me/accounts. This usually means the user token lacks 'pages_show_list' OR the FB account does not admin any Pages. Without a Page, IG Graph cannot expose the IG user id.")

    if pages:
        first_page = next(iter(pages))
        page_token = pages[first_page]

        # Page scope checks (may be irrelevant if we aren't using FB Pages)
        try:
            p_scopes, p_missing = check_required_scopes(page_token)
            print("Page token scopes:", sorted(p_scopes))
            if p_missing:
                print("MISSING scopes on page token ->", p_missing)
        except Exception as e:
            print("Warning: could not check page token scopes:", e)

        # Try resolving IG user id from the linked Page (official IG Graph publishing requires this)
        try:
            ig_id = ig_user_id_from_page(first_page, page_token)
            print("IG User ID for that Page:", ig_id)
        except Exception as e:
            ig_id = ""
            print("Warning: could not resolve IG user id from Page:", e)

        # Update persisted bundle with Page + IG info
        persist_meta_tokens(
            user_token=user_token,
            user_expires_in=user_expires_in,
            pages_map=pages,
            selected_page_id=first_page,
            selected_page_token=page_token,
            ig_user_id=ig_id
        )
        print(f"Saved tokens to: {TOKEN_STORE}")
    else:
        print("No Pages available. Saved only the user token for now.")
        # Re-write file to ensure a clean minimal structure exists
        persist_meta_tokens(
            user_token=user_token,
            user_expires_in=user_expires_in,
            pages_map={},
            selected_page_id="",
            selected_page_token="",
            ig_user_id=""
        )
        print(f"Saved tokens to: {TOKEN_STORE}")

    print("Done.")