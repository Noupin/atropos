# integrations/meta/get_ig_id.py
import json, os, requests, hmac, hashlib
from pathlib import Path

GRAPH = "https://graph.facebook.com/v19.0"
TOKEN_STORE = os.getenv("META_TOKEN_STORE", ".meta_tokens.json")
APP_SECRET = os.getenv("META_APP_SECRET", "")

def _appsecret_proof(token: str) -> str:
    return hmac.new(APP_SECRET.encode(), token.encode(), hashlib.sha256).hexdigest() if APP_SECRET else ""

def _load():
    if not Path(TOKEN_STORE).exists():
        raise FileNotFoundError(f"Token store not found: {TOKEN_STORE}")
    return json.loads(Path(TOKEN_STORE).read_text())

def _save(blob):
    Path(TOKEN_STORE).write_text(json.dumps(blob, indent=2, sort_keys=True))

def _get_pages(user_token: str):
    params = {"access_token": user_token}
    asp = _appsecret_proof(user_token)
    if asp: params["appsecret_proof"] = asp
    r = requests.get(f"{GRAPH}/me/accounts", params=params, timeout=30)
    r.raise_for_status()
    return r.json().get("data", [])

def _get_ig_id(page_id: str, page_token: str):
    params = {
        "fields": "instagram_business_account,connected_instagram_account",
        "access_token": page_token
    }
    asp = _appsecret_proof(page_token)
    if asp: params["appsecret_proof"] = asp
    r = requests.get(f"{GRAPH}/{page_id}", params=params, timeout=30)
    r.raise_for_status()
    data = r.json()
    ig = data.get("instagram_business_account") or data.get("connected_instagram_account")
    return ig["id"] if ig else ""

if __name__ == "__main__":
    blob = _load()
    user_token = blob.get("user_token") or ""
    if not user_token:
        raise SystemExit("No user_token in token store. Run your Meta auth first.")

    # Already have it?
    if blob.get("ig_user_id"):
        print("IG user id already set:", blob["ig_user_id"])
        raise SystemExit(0)

    # Use cached pages if present; otherwise fetch
    pages_map = blob.get("pages") or {}
    pages_list = [{"id": pid, "access_token": tok} for pid, tok in pages_map.items()]
    if not pages_list:
        print("Fetching Pages via /me/accounts … (requires pages_show_list)")
        pages_list = _get_pages(user_token)

    if not pages_list:
        raise SystemExit(
            "No Pages found. Either your IG isn’t linked to a Page, or the user token lacks pages_show_list."
        )

    # Try each page until we find the linked IG
    for p in pages_list:
        pid = p["id"]
        ptoken = p.get("access_token") or pages_map.get(pid) or ""
        if not ptoken:
            print(f"Skipping page {pid}: no page access token available.")
            continue
        try:
            igid = _get_ig_id(pid, ptoken)
            if igid:
                blob["pages"] = {**(blob.get("pages") or {}), pid: ptoken}
                blob["selected_page_id"] = pid
                blob["selected_page_token"] = ptoken
                blob["ig_user_id"] = igid
                _save(blob)
                print("Resolved ig_user_id:", igid, "from Page:", pid)
                break
        except requests.HTTPError as e:
            print(f"Page {pid} lookup failed:", e.response.text[:200])
    else:
        raise SystemExit("No Page returned an Instagram account. Link IG → Page and retry.")