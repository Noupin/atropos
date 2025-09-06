import os
import time
import math
import json
import mimetypes
import requests
from pathlib import Path

from config import TIKTOK_DESC_LIMIT

TOKENS_FILE = Path(
    os.getenv("TIKTOK_TOKENS_FILE")
    or Path(__file__).resolve().parents[2] / "tokens" / "tiktok.json"
)

# Load access token from JSON file
try:
    with open(TOKENS_FILE, "r", encoding="utf-8") as f:
        data = json.load(f)
    ACCESS_TOKEN = data["access_token"]
except FileNotFoundError:  # pragma: no cover - runtime setup
    ACCESS_TOKEN = ""

# ------------ CONFIG (edit these) ------------
VIDEO_PATH = Path(
    "/Users/noahperkins/Documents/Feryv/Clipit/out/Andy_and_Nick_Do_the_Bird_Box_Challenge_-_KF_AF_20190109/shorts/clip_0.00-49.30_r9.2.mp4"
)
CAPTION_TXT = Path(
    "/Users/noahperkins/Documents/Feryv/Clipit/out/Andy_and_Nick_Do_the_Bird_Box_Challenge_-_KF_AF_20190109/shorts/clip_0.00-49.30_r9.2.txt"
)
PRIVACY_LEVEL = "SELF_ONLY"  # or PUBLIC_TO_EVERYONE / MUTUAL_FOLLOW_FRIENDS / SELF_ONLY
CHUNK_SIZE = 10_000_000  # decimal 10MB; TikTok validates against this exact value
POLL_INTERVAL_SEC = 3
POLL_TIMEOUT_SEC = 8 * 60  # 8 minutes
# ---------------------------------------------

API_BASE = "https://open.tiktokapis.com"
INIT_URL = f"{API_BASE}/v2/post/publish/video/init/"
STATUS_URL = f"{API_BASE}/v2/post/publish/status/fetch/"

# TikTok rules (see Media Transfer Guide):
# - total_chunk_count = floor(video_size / chunk_size)
# - Each chunk must be >= 5 MB and <= 64 MB (except final can be > chunk_size up to 128 MB)
MIN_CHUNK = 5_000_000
MAX_SINGLE = 64_000_000  # if video_size <= 64MB, do a single-chunk upload

def _chunk_plan(video_size: int, chunk_size: int):
    """
    Returns (declared_chunk_size, total_chunk_count, full_chunks, remainder)
    Strategy:
      - If size <= 64MB -> single chunk: chunk_size == video_size, total_chunk_count == 1
      - Else -> floor math: total_chunk_count = floor(size / chunk_size); final chunk is chunk_size + remainder
    """
    if video_size <= MAX_SINGLE:
        # One-shot upload. Avoids most validator issues on small files.
        return video_size, 1, 0, video_size

    # Multi-chunk path (decimal chunking)
    full = video_size // chunk_size  # floor
    if full == 0:
        # Size > 64MB should not hit this, but guard anyway
        return video_size, 1, 0, video_size
    rem = video_size - (full * chunk_size)
    return chunk_size, full, full, rem

def read_caption(path: Path) -> str:
    text = path.read_text(encoding="utf-8").strip()
    # TikTok supports hashtags (#tag) and mentions (@handle) in title; max ~2200 UTF-16 units
    return text[:TIKTOK_DESC_LIMIT]

def init_direct_post(video_size: int, chunk_size: int, title: str, privacy_level: str):
    headers = {
        "Authorization": f"Bearer {ACCESS_TOKEN}",
        "Content-Type": "application/json; charset=UTF-8",
    }
    declared_chunk_size, total_chunk_count, full_chunks, remainder = _chunk_plan(video_size, chunk_size)
    body = {
        "post_info": {
            "title": title,
            "privacy_level": privacy_level,
            "disable_duet": False,
            "disable_comment": False,
            "disable_stitch": False,
            # "video_cover_timestamp_ms": 1000,
        },
        "source_info": {
            "source": "FILE_UPLOAD",
            "video_size": video_size,
            "chunk_size": declared_chunk_size,
            "total_chunk_count": total_chunk_count,
        },
    }
    print(body)
    print(f"[INIT] plan: size={video_size} declared_chunk_size={declared_chunk_size} "
          f"full_chunks={full_chunks} remainder={remainder} total_chunk_count={total_chunk_count}")
    resp = requests.post(INIT_URL, headers=headers, data=json.dumps(body), timeout=60)
    # resp.raise_for_status()
    data = resp.json()
    err = data.get("error", {})
    if err.get("code") != "ok":
        raise RuntimeError(f"Init failed: {err}")
    publish_id = data["data"]["publish_id"]
    upload_url = data["data"]["upload_url"]
    return publish_id, upload_url

def put_chunk(upload_url: str, blob: bytes, start: int, end_inclusive: int, total: int, mime: str):
    headers = {
        "Content-Type": mime,
        "Content-Length": str(len(blob)),
        "Content-Range": f"bytes {start}-{end_inclusive}/{total}",
    }
    print(headers)
    r = requests.put(upload_url, headers=headers, data=blob, timeout=180)
    if r.status_code not in (200, 201, 204, 206):
        info = {
            "status": r.status_code,
            "req_range": headers["Content-Range"],
            "resp_headers": dict(r.headers),
            "text": r.text[:400],
        }
        raise RuntimeError(f"Chunk PUT failed: {json.dumps(info)[:1200]}")

def upload_video(upload_url: str, video_path: Path, chunk_size: int):
    total = video_path.stat().st_size
    mime = mimetypes.guess_type(str(video_path))[0] or "video/mp4"

    declared_chunk_size, total_chunk_count, full_chunks, remainder = _chunk_plan(total, chunk_size)

    with video_path.open("rb") as f:
        if total_chunk_count == 1:
            # Whole upload in one go
            blob = f.read()
            start = 0
            end_inclusive = total - 1
            print(f"[PUT] whole: {start}-{end_inclusive}/{total} ({len(blob)} bytes)")
            put_chunk(upload_url, blob, start, end_inclusive, total, mime)
            return total

        # Otherwise, send exactly `full_chunks` chunks.
        # - First `full_chunks - 1` are exactly `declared_chunk_size`.
        # - Final chunk is declared_chunk_size + remainder (can exceed chunk_size as per docs).
        sent = 0
        for i in range(full_chunks):
            if i < full_chunks - 1:
                to_send = declared_chunk_size
            else:
                to_send = declared_chunk_size + (remainder or 0)
            blob = f.read(to_send)
            if len(blob) != to_send:
                raise RuntimeError(f"Read {len(blob)} bytes, expected {to_send}")
            start = sent
            end_inclusive = sent + to_send - 1
            print(f"[PUT] {i+1}/{full_chunks} -> {start}-{end_inclusive}/{total} ({to_send} bytes)")
            put_chunk(upload_url, blob, start, end_inclusive, total, mime)
            sent += to_send

        if sent != total:
            raise RuntimeError(f"Sent {sent} bytes but total is {total}")

    return total

def poll_status(publish_id: str, timeout_sec: int = POLL_TIMEOUT_SEC, interval_sec: int = POLL_INTERVAL_SEC):
    headers = {
        "Authorization": f"Bearer {ACCESS_TOKEN}",
        "Content-Type": "application/json; charset=UTF-8",
    }
    start = time.time()
    last = None
    while True:
        resp = requests.post(STATUS_URL, headers=headers, json={"publish_id": publish_id}, timeout=30)
        resp.raise_for_status()
        j = resp.json()
        err = j.get("error", {})
        if err.get("code") != "ok":
            raise RuntimeError(f"status error: {err}")
        data = j.get("data", {})
        status = data.get("status")
        last = data
        # PROCESSING_UPLOAD / PROCESSING_DOWNLOAD / SEND_TO_USER_INBOX / PUBLISH_COMPLETE / FAILED
        if status in ("PUBLISH_COMPLETE", "FAILED"):
            return data
        if time.time() - start > timeout_sec:
            raise TimeoutError(f"Timed out waiting for publish. Last status: {data}")
        time.sleep(interval_sec)

def main():
    if not VIDEO_PATH.exists():
        raise FileNotFoundError(VIDEO_PATH)
    if not CAPTION_TXT.exists():
        raise FileNotFoundError(CAPTION_TXT)

    title = read_caption(CAPTION_TXT)
    size = VIDEO_PATH.stat().st_size

    print(f"[1/3] INIT direct post…")
    publish_id, upload_url = init_direct_post(size, CHUNK_SIZE, title, PRIVACY_LEVEL)
    print(f"    publish_id={publish_id}")
    print(f"    upload_url={upload_url[:80]}…")

    declared_chunk_size, total_chunk_count, full_chunks, remainder = _chunk_plan(size, CHUNK_SIZE)
    print(f"[2/3] UPLOAD {VIDEO_PATH.name} ({size/1_000_000:.2f} MB) in {total_chunk_count} chunk(s)…")
    upload_video(upload_url, VIDEO_PATH, CHUNK_SIZE)
    print("    upload complete.")

    print(f"[3/3] POLL status…")
    result = poll_status(publish_id)
    print("Final:", json.dumps(result, indent=2))

if __name__ == "__main__":
    main()
