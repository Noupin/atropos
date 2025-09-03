"""
Instagram Reels publishing via Instagram Graph API.
Requirements:
- Use graph.facebook.com (NOT graph.instagram.com) for content publishing.
- video_url must be publicly reachable over HTTPS (Meta will fetch it). Localhost will fail.
- IG account must be Professional and linked to a Facebook Page.
- ACCESS_TOKEN should be a long-lived user or page token with instagram_basic and instagram_content_publish; pages_show_list needed for discovery elsewhere.
- Optional: set META_APP_SECRET to enable appsecret_proof.
"""
import os, time, requests, http.server, threading
from pathlib import Path

GRAPH = "https://graph.facebook.com/v19.0"
REQ_TIMEOUT = 30

ACCESS_TOKEN = os.getenv("IG_ACCESS_TOKEN")
IG_USER_ID = os.getenv("IG_USER_ID")  # Instagram Business/Creator account ID
PUBLIC_URL_BASE = os.getenv("PUBLIC_URL_BASE", "https://atropos-video.com/serve")  # Must be publicly reachable HTTPS for Meta to fetch
PORT = 8000  # If serving locally

APP_SECRET = os.getenv("META_APP_SECRET", "")
import hmac, hashlib

def appsecret_proof(token: str):
    if not APP_SECRET:
        return None
    return hmac.new(APP_SECRET.encode(), token.encode(), hashlib.sha256).hexdigest()

def serve_folder(folder_path):
    os.chdir(folder_path)
    httpd = http.server.HTTPServer(("0.0.0.0", PORT), http.server.SimpleHTTPRequestHandler)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    return httpd

def create_reels_container(video_url, caption="", share_to_feed=True):
    url = f"{GRAPH}/{IG_USER_ID}/media"
    data = {
        "media_type": "REELS",
        "video_url": video_url,
        "caption": caption,
        "share_to_feed": bool(share_to_feed),
        "access_token": ACCESS_TOKEN,
    }
    proof = appsecret_proof(ACCESS_TOKEN)
    if proof:
        data["appsecret_proof"] = proof
    r = requests.post(url, data=data, timeout=REQ_TIMEOUT)
    r.raise_for_status()
    return r.json().get("id")

def check_container_status(creation_id, interval=5, timeout=300):
    url = f"{GRAPH}/{creation_id}"
    params = {"fields": "status_code", "access_token": ACCESS_TOKEN}
    proof = appsecret_proof(ACCESS_TOKEN)
    if proof:
        params["appsecret_proof"] = proof
    start = time.time()
    while time.time() - start < timeout:
        r = requests.get(url, params=params, timeout=REQ_TIMEOUT)
        r.raise_for_status()
        status = r.json().get("status_code")
        print(f"[status] container {creation_id} → {status}")
        if status == "FINISHED":
            return True
        if status in {"ERROR", "EXPIRED"}:
            raise RuntimeError(f"Container status error: {status}")
        time.sleep(interval)
    raise TimeoutError("Upload timed out")

def publish_reels(creation_id):
    url = f"{GRAPH}/{IG_USER_ID}/media_publish"
    data = {"creation_id": creation_id, "access_token": ACCESS_TOKEN}
    proof = appsecret_proof(ACCESS_TOKEN)
    if proof:
        data["appsecret_proof"] = proof
    r = requests.post(url, data=data, timeout=REQ_TIMEOUT)
    r.raise_for_status()
    return r.json().get("id")

from urllib.parse import urlparse

def _is_public_https(url: str) -> bool:
    try:
        u = urlparse(url)
        return u.scheme == "https" and not u.hostname in {"localhost", "127.0.0.1"}
    except Exception:
        return False


def upload_local_reel(video_path, caption=""):
    folder = Path(video_path).parent
    httpd = None
    try:
        # If caller passed an actual URL, use it directly.
        if video_path.startswith("http://") or video_path.startswith("https://"):
            public_video_url = video_path
        else:
            # Build a URL from PUBLIC_URL_BASE + filename
            filename = Path(video_path).name
            public_video_url = PUBLIC_URL_BASE.rstrip("/") + f"/{filename}"

        if not _is_public_https(public_video_url):
            raise ValueError(
                "video_url must be public HTTPS (S3, R2, Cloudflare, or a tunnel). Set PUBLIC_URL_BASE=https://your-host/path"
            )

        # Optional: serve locally if user insists on localhost (best effort dev-only)
        if "localhost" in public_video_url or "127.0.0.1" in public_video_url:
            # Make the file available at http://0.0.0.0:PORT but Meta will not fetch localhost
            httpd = serve_folder(str(folder))
            time.sleep(1)

        creation_id = create_reels_container(public_video_url, caption, share_to_feed=True)
        print(f"Created container: {creation_id}")
        if check_container_status(creation_id):
            post_id = publish_reels(creation_id)
            print(f"Published Reel ID: {post_id}")
            return post_id
    finally:
        if httpd:
            httpd.shutdown()

# Example usage:
if __name__ == "__main__":
    video_file = "/Users/noahperkins/Documents/Feryv/Clipit/out/Andy_and_Nick_Do_the_Bird_Box_Challenge_-_KF_AF_20190109/shorts/clip_0.00-49.30_r9.2_vertical.mp4"
    desc_path = Path("/Users/noahperkins/Documents/Feryv/Clipit/out/Andy_and_Nick_Do_the_Bird_Box_Challenge_-_KF_AF_20190109/shorts/clip_0.00-49.30_r9.2_description.txt")
    caption = desc_path.read_text().strip() if desc_path.exists() else ""

    assert ACCESS_TOKEN, "Missing IG access token"
    assert IG_USER_ID, "Missing IG user id"

    reel_id = upload_local_reel(video_file, caption)
    print("Done uploading Reel:", reel_id)