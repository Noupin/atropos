from __future__ import annotations
from pathlib import Path
from typing import Optional, Callable
import json
import os
import time

# --- Constants (no argparse, edit here) ---
USERNAME = os.getenv("IG_USERNAME")
PASSWORD = os.getenv("IG_PASSWORD")
VIDEO_PATH = Path("/Users/noahperkins/Documents/Feryv/Clipit/out/Andy_and_Nick_Do_the_Bird_Box_Challenge_-_KF_AF_20190109/shorts/clip_0.00-49.30_r9.2_vertical.mp4")
DESC_PATH = Path("/Users/noahperkins/Documents/Feryv/Clipit/out/Andy_and_Nick_Do_the_Bird_Box_Challenge_-_KF_AF_20190109/shorts/clip_0.00-49.30_r9.2_description.txt")
SESSION_PATH = Path(__file__).with_name("instagrapi_session.json")
STATE_PATH = Path(__file__).with_name("instagrapi_state.json")  # optional debug

# Upload tuning
MAX_RETRIES = 3
RETRY_BACKOFF_SEC = 5

# --- instagrapi import ---
from instagrapi import Client
from instagrapi.exceptions import LoginRequired, ChallengeRequired, PleaseWaitFewMinutes


def _read_caption(desc_path: Path) -> str:
    if desc_path.exists():
        txt = desc_path.read_text(encoding="utf-8", errors="ignore").strip()
        # IG caps caption around 2,200 chars; trim defensively
        if len(txt) > 2100:
            txt = txt[:2100] + "\n…"
        return txt
    return ""


def _challenge_code_handler(username: str, choice: str) -> str:
    """Prompt the user for a 2FA/challenge code in terminal.
    `choice` is usually 'email' or 'sms'.
    """
    print(f"Challenge for {username} via {choice}. Check your {choice} and paste the 6‑digit code.")
    return input("Enter code: ").strip()


def build_client(session_path: Path = SESSION_PATH) -> Client:
    cl = Client()
    # load saved device/session if present to reduce challenges
    if session_path.exists():
        try:
            cl.load_settings(str(session_path))
        except Exception:
            pass
    # tighten timeouts a bit for desktop use
    cl.request_timeout = 30
    cl.request_read_timeout = 60
    cl.request_write_timeout = 60
    return cl


def login_or_resume(cl: Client, username: str, password: str, session_path: Path = SESSION_PATH) -> None:
    # Try login with existing settings first
    try:
        cl.login(username, password)
    except ChallengeRequired:
        # SMS/Email challenge workflow
        code = _challenge_code_handler(username, "email/sms")
        cl.login(username, password, verification_code=code)
    except PleaseWaitFewMinutes as e:
        print(f"Rate limited on login: {e}. Sleeping 300s…")
        time.sleep(300)
        cl.login(username, password)
    except Exception:
        # If failed, wipe settings and do a clean login
        try:
            cl.set_settings({})
        except Exception:
            pass
        cl.login(username, password)
    # Persist the session/device so subsequent runs are smoother
    try:
        cl.dump_settings(str(session_path))
    except Exception:
        pass


def clip_upload_with_retries(cl: Client, video_path: Path, caption: str) -> dict:
    last_exc: Optional[Exception] = None
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            media = cl.clip_upload(
                str(video_path),
                caption,
                extra_data={
                    # Toggle example flags if you want
                    # "disable_comments": 0,
                    # "like_and_view_counts_disabled": 0,
                },
            )
            return {
                "status": "ok",
                "pk": getattr(media, "pk", None),
                "code": getattr(media, "code", None),
                "id": getattr(media, "id", None),
            }
        except LoginRequired:
            print("Session expired: re-login…")
            login_or_resume(cl, USERNAME, PASSWORD)
        except PleaseWaitFewMinutes as e:
            print(f"Upload throttled (attempt {attempt}/{MAX_RETRIES}): {e}")
            time.sleep(RETRY_BACKOFF_SEC * attempt)
        except Exception as e:
            last_exc = e
            print(f"Upload failed (attempt {attempt}/{MAX_RETRIES}): {e}")
            time.sleep(RETRY_BACKOFF_SEC * attempt)
    if last_exc:
        raise last_exc
    raise RuntimeError("Unknown upload failure")


def save_state(path: Path, data: dict) -> None:
    try:
        path.write_text(json.dumps(data, indent=2), encoding="utf-8")
    except Exception:
        pass


def main() -> None:
    assert VIDEO_PATH.exists(), f"Video not found: {VIDEO_PATH}"
    caption = _read_caption(DESC_PATH)

    cl = build_client()
    login_or_resume(cl, USERNAME, PASSWORD)

    result = clip_upload_with_retries(cl, VIDEO_PATH, caption)
    print("Uploaded:", result)
    save_state(STATE_PATH, {"uploaded": result, "video": str(VIDEO_PATH), "caption": caption})


if __name__ == "__main__":
    main()