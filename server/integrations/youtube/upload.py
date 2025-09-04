# server/integrations/youtube/upload.py

from __future__ import annotations
from pathlib import Path
import mimetypes
import sys

from googleapiclient.discovery import build
from googleapiclient.http import MediaFileUpload
from googleapiclient.errors import HttpError

from .auth import ensure_creds

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
    Default: first non-empty, non-hashtag-only line is the title; the rest is the description.
    Enforces YouTube limits (title<=100 chars, description<=5000 bytes approx.).
    """
    if not path.exists():
        return ("Untitled clip", "")
    raw = path.read_text(encoding="utf-8", errors="ignore").strip()
    lines = [ln.strip() for ln in raw.splitlines() if ln.strip()]
    # choose first line that is not just hashtags
    title_line = next((ln for ln in lines if not ln.lstrip().startswith('#')), "Untitled clip")
    # sanitize title: remove angle brackets which are not allowed by API
    title_clean = title_line.replace('<', '').replace('>', '').strip()
    if not title_clean:
        title_clean = "Untitled clip"
    # enforce max 100 characters per API
    title_clean = title_clean[:100]

    # description is everything except the chosen title line
    rest_lines = [ln for ln in lines if ln is not title_line]
    desc_text = "\n".join(rest_lines).strip()

    # --- Hashtag extraction and appending to title ---
    import re
    # Extract hashtags from the description text
    hashtag_pattern = r"(?:^|\s)(#\w+)"
    hashtags = re.findall(hashtag_pattern, desc_text)
    hashtags = [tag.strip() for tag in hashtags if tag.strip()]
    first_hashtags = hashtags[:3]  # up to 3
    # Compose hashtags as a string to append
    hashtags_str = " ".join(first_hashtags)
    if hashtags_str:
        # Try to append hashtags to title_clean, respecting 100 char limit
        # Leave a space if needed
        available = 100 - len(title_clean)
        if available > 0:
            # Add a space if title_clean doesn't already end with space and hashtags_str isn't empty
            sep = "" if title_clean.endswith(" ") or not title_clean else " "
            hashtags_to_add = hashtags_str
            # If too long, truncate hashtags_str
            if len(sep + hashtags_str) > available:
                # Try to fit as many hashtags as possible
                tags = []
                total = len(sep)
                for tag in first_hashtags:
                    taglen = len(tag) + (1 if tags else 0)
                    if total + taglen > available:
                        break
                    tags.append(tag)
                    total += taglen
                hashtags_to_add = " ".join(tags)
            if hashtags_to_add:
                title_clean = (title_clean + sep + hashtags_to_add).strip()
        # Ensure final title is max 100 chars
        title_clean = title_clean[:100]

    # keep within ~5000 chars
    if len(desc_text) > 4900:
        desc_text = desc_text[:4900]
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