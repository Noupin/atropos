import subprocess
from datetime import datetime

from typing import Any, Callable

import yt_dlp
from yt_dlp.utils import DownloadError
from youtube_transcript_api import YouTubeTranscriptApi
from youtube_transcript_api._errors import NoTranscriptFound, TranscriptsDisabled

from helpers.notifications import send_failure_email
from helpers.transcript import normalize_quotes


def is_youtube_url(url: str) -> bool:
    """Return True if the URL points to YouTube."""
    return "youtube.com" in url or "youtu.be" in url


def is_twitch_url(url: str) -> bool:
    """Return True if the URL points to Twitch."""
    return "twitch.tv" in url

def extract_video_id(url: str) -> str:
    if "v=" in url:
        # Standard YouTube URL
        video_id = url.split("v=")[1].split("&")[0]
    elif "youtu.be/" in url:
        # Shortened URL
        video_id = url.split("youtu.be/")[1].split("?")[0].split("&")[0]
    elif "/shorts/" in url:
        # Shorts URL
        video_id = url.split("/shorts/")[1].split("?")[0].split("&")[0]
    else:
        # Assume raw ID
        video_id = url
    return video_id


def get_video_urls(url: str) -> list[str]:
    """Return a list of video URLs for the provided link.

    If the URL points to a YouTube playlist, this returns URLs for each entry.
    For non-YouTube URLs (e.g., Twitch VODs), the original URL is returned
    in a single-item list.
    """

    if not is_youtube_url(url):
        return [url]

    ydl_opts = {
        "quiet": True,
        "extract_flat": True,
        "force_flat_playlist": True,
        "no_warnings": True,
    }
    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)
    except DownloadError as exc:
        send_failure_email(
            "Playlist retrieval failed",
            f"Skipping {url}: {exc}",
        )
        return []

    if not info:
        return []

    entries = info.get("entries")
    if not entries:
        return [url]

    urls: list[str] = []
    for entry in entries:
        entry_url = entry.get("url")
        if not entry_url:
            video_id = entry.get("id")
            if video_id:
                entry_url = f"https://www.youtube.com/watch?v={video_id}"
        if entry_url:
            urls.append(entry_url)
    return urls

def get_video_info(url: str):
    ydl_opts = {
        "quiet": True,
        "extract_flat": True,
        "force_flat_playlist": True,
        "no_warnings": True,
        "format": "bestvideo+bestaudio/best",
    }
    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)
    except DownloadError as exc:
        send_failure_email(
            "Private or unlisted video",
            f"Skipping {url}: {exc}",
        )
        return None
    if info is None:
        send_failure_email(
            "Video info retrieval failed",
            f"Skipping {url}: no information returned",
        )
        return None

    title = info.get("title", "Unknown Title")
    upload_date = info.get("upload_date") or info.get("release_date")
    if not upload_date and info.get("timestamp"):
        upload_date = datetime.utcfromtimestamp(info["timestamp"]).strftime("%Y%m%d")
    if not upload_date:
        upload_date = "Unknown Date"
    uploader = info.get("uploader") or info.get("channel") or "Unknown Channel"
    return {
        "title": title,
        "upload_date": upload_date,
        "uploader": uploader,
    }

ProgressHook = Callable[[float, dict[str, Any]], None]


def _build_progress_hook(callback: ProgressHook | None) -> Callable[[dict[str, Any]], None]:
    def _hook(status: dict[str, Any]) -> None:
        if not callback:
            return
        state = status.get("status")
        if state == "downloading":
            downloaded = status.get("downloaded_bytes") or 0
            total = status.get("total_bytes") or status.get("total_bytes_estimate") or 0
            if total:
                fraction = max(0.0, min(1.0, downloaded / total))
                callback(fraction, status)
        elif state == "finished":
            callback(1.0, status)

    return _hook


def download_video(
    url, output_path: str = "output_video.mp4", *, progress_callback: ProgressHook | None = None
):
    try:
        with yt_dlp.YoutubeDL(
            {
                "format": "bestvideo+bestaudio/best",
                "outtmpl": output_path,
                "merge_output_format": "mp4",
                "progress_hooks": [_build_progress_hook(progress_callback)],
            }
        ) as ydl:
            ydl.download([url])
        print(f"Downloaded video to {output_path}")
    except Exception as e:
        print(f"Error: {str(e)}")

def download_audio(
    url, output_path: str = "output_audio.mp3", *, progress_callback: ProgressHook | None = None
):
    try:
        with yt_dlp.YoutubeDL(
            {
                "format": "bestaudio/best",
                "outtmpl": output_path,
                "progress_hooks": [_build_progress_hook(progress_callback)],
            }
        ) as ydl:
            ydl.download([url])
        print(f"Downloaded audio to {output_path}")
    except Exception as e:
        print(f"Error: {str(e)}")

def extract_audio_from_video(video_path, audio_output_path='extracted_audio.mp3'):
    try:
        # Use ffmpeg to extract audio from the video file
        subprocess.run(
            ['ffmpeg', '-i', video_path, '-vn', '-acodec', 'libmp3lame', audio_output_path],
            check=True
        )
        print(f"Extracted audio to {audio_output_path}")
    except Exception as e:
        print(f"Error: {str(e)}")

def download_transcript(url, output_path: str = "transcript.txt", languages=None):
    if not is_youtube_url(url):
        print("TRANSCRIPT: No transcript downloader available for this URL.")
        return False
    video_id = extract_video_id(url)
    try:
        api = YouTubeTranscriptApi()
        transcript = api.fetch(video_id, languages=languages)
    except AttributeError:
        try:
            transcript = YouTubeTranscriptApi.get_transcript(video_id, languages=languages)
        except NoTranscriptFound:
            print("TRANSCRIPT: No transcript found for this video.")
            return False
        except TranscriptsDisabled:
            print("TRANSCRIPT: Transcripts are disabled for this video.")
            return False
    except NoTranscriptFound:
        print("TRANSCRIPT: No transcript found for this video.")
        return False
    except TranscriptsDisabled:
        print("TRANSCRIPT: Transcripts are disabled for this video.")
        return False
    try:
        with open(output_path, "w", encoding="utf-8") as f:
            # `transcript` may be FetchedTranscriptSnippet objects or dicts depending on version.
            for snippet in transcript:
                try:
                    start = snippet.start
                    duration = snippet.duration or 0
                    text = snippet.text
                except AttributeError:
                    start = snippet.get("start", 0)
                    duration = snippet.get("duration", 0) or 0
                    text = snippet.get("text", "")
                end = (start or 0) + (duration or 0)
                text = normalize_quotes((text or "").replace("\n", " ").strip())
                f.write(f"[{start:.2f} -> {end:.2f}] {text}\n")
        print(f"TRANSCRIPT: Downloaded transcript to {output_path}")
        return True
    except Exception as e:
        print(f"TRANSCRIPT: Error writing transcript: {str(e)}")
        return False

if __name__ == "__main__":
    yt_url = 'https://www.youtube.com/watch?v=GDbDRWzFfds'
    # yt_url = input("Enter YouTube video URL: ")
    video_info = get_video_info(yt_url)
    if video_info:
        title = video_info['title']
        upload_date = video_info['upload_date']
        # Sanitize the title to make it file system safe
        sanitized_title = ''.join(char if char.isalnum() or char in '._-' else '_' for char in title)
        # Ensure the upload date is in the correct format (YYYYMMDD)
        if len(upload_date) == 8:
            upload_date = upload_date[:4] + upload_date[4:6] + upload_date[6:]
        else:
            upload_date = 'Unknown_Date'
        # Create safe file names
        video_output_path = f"{sanitized_title}_{upload_date}.mp4"
        audio_output_path = f"{sanitized_title}_{upload_date}.mp3"
        transcript_output_path = f"{sanitized_title}_{upload_date}_transcript.txt"
        print(f"Video title: {title}")
        print(f"Upload date: {upload_date}")
        print(f"Saving video as: {video_output_path}")
        print(f"Saving audio as: {audio_output_path}")
        # download_video(yt_url, video_output_path)
        # extract_audio_from_video(video_output_path, audio_output_path)
        download_transcript(yt_url, transcript_output_path, languages=['en', 'en-US', 'en-GB'])
        # download_audio(yt_url, audio_output_path)
    else:
        print("Failed to retrieve video information.")
