from __future__ import annotations

from pathlib import Path
from typing import Optional
import json
import os
import time

# Upload tuning
MAX_RETRIES = 3
RETRY_BACKOFF_SEC = 5


def get_username() -> str | None:
    """Return the Instagram username from the environment."""

    return os.environ.get("IG_USERNAME")


def get_password() -> str | None:
    """Return the Instagram password from the environment."""

    return os.environ.get("IG_PASSWORD")


def get_session_path() -> Path:
    """Return the path to the instagrapi session file."""

    return Path(
        os.environ.get("IG_SESSION_FILE")
        or Path(__file__).with_name("instagrapi_session.json")
    )


def get_state_path() -> Path:
    """Return the path to the optional state file."""

    return Path(
        os.environ.get("IG_STATE_FILE")
        or Path(__file__).with_name("instagrapi_state.json")
    )


def get_video_path() -> Path:
    """Return the default video path for manual runs."""

    return Path(os.environ.get("IG_VIDEO_PATH", "video.mp4"))


def get_desc_path() -> Path:
    """Return the default description path for manual runs."""

    return Path(os.environ.get("IG_DESC_PATH", "video.txt"))


# --- instagrapi import ---
from instagrapi import Client
from instagrapi.exceptions import LoginRequired, ChallengeRequired, PleaseWaitFewMinutes
from pydantic import ValidationError


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


def build_client(session_path: Path | None = None) -> Client:
    """Return an instagrapi client using ``session_path`` if provided."""

    session_path = session_path or get_session_path()
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


def login_or_resume(
    cl: Client,
    username: str,
    password: str,
    session_path: Path | None = None,
) -> None:
    # Try login with existing settings first
    session_path = session_path or get_session_path()
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


def clip_upload_with_retries(
    cl: Client,
    video_path: Path,
    caption: str,
    username: str,
    password: str,
) -> dict:
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
            login_or_resume(cl, username, password)
        except PleaseWaitFewMinutes as e:
            print(f"Upload throttled (attempt {attempt}/{MAX_RETRIES}): {e}")
            time.sleep(RETRY_BACKOFF_SEC * attempt)
        except ValidationError as exc:
            last_json = getattr(cl, "last_json", None)
            if isinstance(last_json, dict):
                status = last_json.get("status") or "ok"
                media = last_json.get("media") or {}
                if status == "ok" or media:
                    print(
                        "Upload succeeded but response validation failed; "
                        "using configure payload metadata.",
                    )
                    return {
                        "status": status,
                        "pk": media.get("pk"),
                        "code": media.get("code"),
                        "id": media.get("id"),
                    }
            last_exc = exc
            print(
                "Upload failed due to response validation error "
                f"(attempt {attempt}/{MAX_RETRIES}): {exc}",
            )
            time.sleep(RETRY_BACKOFF_SEC * attempt)
        except Exception as e:
            last_exc = e
            print(f"Upload failed (attempt {attempt}/{MAX_RETRIES}): {e}")
            time.sleep(RETRY_BACKOFF_SEC * attempt)
    if last_exc:
        raise last_exc
    raise RuntimeError("Unknown upload failure")


def save_state(data: dict, path: Path | None = None) -> None:
    """Persist ``data`` to the state file for debugging."""

    path = path or get_state_path()
    try:
        path.write_text(json.dumps(data, indent=2), encoding="utf-8")
    except Exception:
        pass


def main() -> None:
    """CLI entry point for manual uploads."""

    video_path = get_video_path()
    desc_path = get_desc_path()
    assert video_path.exists(), f"Video not found: {video_path}"
    caption = _read_caption(desc_path)

    username = get_username() or ""
    password = get_password() or ""

    cl = build_client()
    login_or_resume(cl, username, password)

    result = clip_upload_with_retries(cl, video_path, caption, username, password)
    print("Uploaded:", result)
    save_state({"uploaded": result, "video": str(video_path), "caption": caption})


if __name__ == "__main__":
    main()
