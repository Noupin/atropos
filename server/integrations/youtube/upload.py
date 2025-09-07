# server/integrations/youtube/upload.py

from __future__ import annotations
from pathlib import Path
import mimetypes
import sys

from googleapiclient.discovery import build
from googleapiclient.http import MediaFileUpload
from googleapiclient.errors import HttpError

from .auth import ensure_creds
from helpers.description import maybe_append_website_link
from config import YOUTUBE_DESC_LIMIT

# --- Configuration ---
VIDEO_PATH = Path(
    "/Users/noahperkins/Documents/Feryv/Clipit/out/Andy_and_Nick_Do_the_Bird_Box_Challenge_-_KF_AF_20190109/shorts/clip_0.00-49.30_r9.2.mp4"
)
DESC_PATH = Path(
    "/Users/noahperkins/Documents/Feryv/Clipit/out/Andy_and_Nick_Do_the_Bird_Box_Challenge_-_KF_AF_20190109/shorts/clip_0.00-49.30_r9.2.txt"
)
PRIVACY = "public"        # or 'unlisted' or 'private'
CATEGORY_ID = "23"        # e.g., 22 for People & Blogs, 23 for Comedy

CHUNKSIZE = 8 * 1024 * 1024  # 8MB works well; library handles resumable uploading

# --- Functions ---
def read_description(path: Path) -> tuple[str, str]:
    """
    Reads the description file and splits into (title, rest_description).
    The title is composed exclusively of the first few hashtags found in the
    description text (up to four). The rest of the text becomes the video
    description.
    """
    if not path.exists():
        return ("Untitled clip", "")

    raw = path.read_text(encoding="utf-8", errors="ignore").strip()
    desc_text = maybe_append_website_link(raw)

    import re

    hashtag_pattern = r"(?:^|\s)(#\w+)"
    hashtags = [tag.strip() for tag in re.findall(hashtag_pattern, desc_text)]
    title_hashtags = hashtags[:4]

    credit_line = ""
    for line in desc_text.splitlines():
        if line.lower().startswith("credit:"):
            credit_line = line.strip()
            break

    title_parts: list[str] = []
    if credit_line:
        title_parts.append(credit_line)
    if title_hashtags:
        title_parts.append(" ".join(title_hashtags))

    title_clean = " ".join(title_parts).strip()[:100]

    desc_text = desc_text[:YOUTUBE_DESC_LIMIT]
    return title_clean, desc_text


def assert_valid_video(path: Path):
    if not path.exists():
        raise FileNotFoundError(f"Video file not found: {path}")
    if path.suffix.lower() != ".mp4":
        raise ValueError("Uploaded file must be an .mp4 video.")

def build_service():
    creds = ensure_creds()
    return build("youtube", "v3", credentials=creds)

def upload_video(path: Path, title: str, description: str, privacy: str, category_id: str):
    media = MediaFileUpload(
        filename=str(path),
        mimetype=mimetypes.guess_type(str(path))[0] or "video/*",
        chunksize=CHUNKSIZE,
        resumable=True
    )

    request_body = {
        "snippet": {
            "title": title,        # you can change this to a separate title if needed
            "description": description,
            "categoryId": category_id
        },
        "status": {
            "privacyStatus": privacy
        }
    }

    service = build_service()
    request = service.videos().insert(
        part="snippet,status",
        body=request_body,
        media_body=media
    )

    print("Uploading video…")
    response = None
    while response is None:
        status, response = request.next_chunk()
        if status:
            print(f"Upload progress: {int(status.progress() * 100)}%")

    return response

# --- Entry Point ---
if __name__ == "__main__":
    assert_valid_video(VIDEO_PATH)
    title, description = read_description(DESC_PATH)

    try:
        response = upload_video(VIDEO_PATH, title, description, PRIVACY, CATEGORY_ID)
        video_id = response.get("id")
        print("✅ Upload complete! Video ID:", video_id)
    except HttpError as err:
        print("YouTube API error:", err)
        sys.exit(1)

