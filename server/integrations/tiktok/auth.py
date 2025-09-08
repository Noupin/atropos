# tiktok_desktop_pkce_demo.py
# Deprecated path: set TIKTOK_UPLOAD_BACKEND='api' to re-enable. Default is
# 'autouploader' until TikTok app is approved. TODO: remove when feature flag is
# dropped.
import os
from pathlib import Path
# Constants you edit once:
CLIENT_KEY = os.environ.get("TIKTOK_CLIENT_KEY")
CLIENT_SECRET = os.environ.get("TIKTOK_CLIENT_SECRET")  # some flows accept without; include if your app requires it
SCOPES = ["user.info.basic", "video.publish"]          # comma-separated in URL (TikTok desktop spec)
REDIRECT_PATH = "/tiktok/auth/callback/"  # note trailing slash (keep it stable)

TOKENS_FILE = Path(
    os.getenv("TIKTOK_TOKENS_FILE")
    or Path(__file__).resolve().parents[2] / "tokens" / "tiktok.json"
)

import http.server, socket, webbrowser, urllib.parse, hashlib, secrets, json, requests, threading

def random_free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port

def gen_code_verifier(n=64):
    # TikTok requires unreserved chars: A-Z a-z 0-9 - . _ ~
    alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~"
    return "".join(secrets.choice(alphabet) for _ in range(n))

def hex_sha256(s: str) -> str:
    return hashlib.sha256(s.encode("utf-8")).hexdigest()

def build_authorize_url(client_key, scopes_csv, redirect_uri, state, code_challenge):
    base = "https://www.tiktok.com/v2/auth/authorize/"
    q = {
        "client_key": client_key,
        "response_type": "code",
        "scope": scopes_csv,                       # comma-separated
        "redirect_uri": redirect_uri,              # must exactly match registered pattern
        "state": state,
        "code_challenge": code_challenge,          # hex SHA256 of verifier
        "code_challenge_method": "S256",
    }
    return base + "?" + urllib.parse.urlencode(q)

def exchange_code_for_tokens(code, redirect_uri, code_verifier):
    url = "https://open.tiktokapis.com/v2/oauth/token/"
    data = {
        "client_key": CLIENT_KEY,
        "client_secret": CLIENT_SECRET,   # include if your app needs it
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": redirect_uri,     # TikTok expects this in body
        "code_verifier": code_verifier,
    }
    r = requests.post(url, data=data, timeout=30)
    r.raise_for_status()
    return r.json()


def refresh_tokens() -> bool:
    """Attempt to refresh TikTok access token using stored refresh token.

    Returns ``True`` if the token was refreshed and saved, ``False`` otherwise.
    """
    try:
        data = json.loads(TOKENS_FILE.read_text(encoding="utf-8"))
    except Exception:
        return False

    refresh_token = data.get("refresh_token")
    if not refresh_token:
        return False

    url = "https://open.tiktokapis.com/v2/oauth/token/"
    body = {
        "client_key": CLIENT_KEY,
        "client_secret": CLIENT_SECRET,
        "grant_type": "refresh_token",
        "refresh_token": refresh_token,
    }
    headers = {
        "Content-Type": "application/x-www-form-urlencoded",
        "Cache-Control": "no-cache",
    }

    try:
        resp = requests.post(url, data=body, headers=headers, timeout=30)
        resp.raise_for_status()
        payload = resp.json()
    except Exception:
        return False

    # TikTok returns an error field on failure even with HTTP 200
    if payload.get("error") or "access_token" not in payload:
        return False

    TOKENS_FILE.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    return True

def run():
    port = 3455
    redirect_uri = f"http://localhost:{port}{REDIRECT_PATH}"
    # IMPORTANT: in TikTok Developer Console, add a redirect like:
    #   http://127.0.0.1:*/tiktok/auth/callback/
    # (Wildcard port * is allowed for desktop)
    state = "clipit-" + secrets.token_hex(8)
    code_verifier = gen_code_verifier()
    code_challenge = hex_sha256(code_verifier)
    scopes_csv = ",".join(SCOPES)

    auth_url = build_authorize_url(CLIENT_KEY, scopes_csv, redirect_uri, state, code_challenge)
    print("Open this URL if your browser didn't launch:\n", auth_url)

    # tiny callback server
    code_holder = {"code": None, "state": None, "error": None}
    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            if not self.path.startswith(REDIRECT_PATH):
                self.send_response(404); self.end_headers(); return
            qs = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            code = (qs.get("code") or [None])[0]
            ret_state = (qs.get("state") or [None])[0]
            err = (qs.get("error") or [None])[0]
            code_holder["code"] = code
            code_holder["state"] = ret_state
            code_holder["error"] = err
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.end_headers()
            self.wfile.write(b"Linked! You can close this window.")
        def log_message(self, *args): pass  # quiet

    httpd = http.server.ThreadingHTTPServer(("127.0.0.1", port), Handler)
    t = threading.Thread(target=httpd.serve_forever, daemon=True)
    t.start()

    webbrowser.open(auth_url)

    # Wait for code
    print("Waiting for TikTok redirect on", redirect_uri)
    for _ in range(600):  # ~60s
        if code_holder["code"] or code_holder["error"]:
            break
        import time; time.sleep(0.1)

    httpd.shutdown()

    if code_holder["error"]:
        raise RuntimeError(f"TikTok returned error: {code_holder['error']}")
    if not code_holder["code"]:
        raise RuntimeError("Timed out waiting for authorization code.")

    if code_holder["state"] != state:
        raise RuntimeError("State mismatch — possible CSRF or bad redirect.")

    tokens = exchange_code_for_tokens(code_holder["code"], redirect_uri, code_verifier)
    with open(TOKENS_FILE, "w") as f:
        json.dump(tokens, f, indent=2)
    print("Saved tokens to", TOKENS_FILE)
    print(json.dumps(tokens, indent=2))

if __name__ == "__main__":
    print("TikTok Desktop PKCE demo starting…")
    run()
