import yt_dlp
import subprocess
from youtube_transcript_api import YouTubeTranscriptApi
from youtube_transcript_api._errors import NoTranscriptFound, TranscriptsDisabled

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
    """Return a list of video URLs for the provided YouTube link.

    If the URL points to a playlist, this returns URLs for each entry.
    Otherwise the original URL is returned in a single-item list. Entries
    that cannot be resolved to a usable URL are skipped.
    """

    ydl_opts = {
        "quiet": True,
        "extract_flat": True,
        "force_flat_playlist": True,
        "no_warnings": True,
    }
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(url, download=False)

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

def get_video_info(url):
    ydl_opts = {
        'quiet': True,
        'extract_flat': True,
        'force_flat_playlist': True,
        'no_warnings': True,
        'format': 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
    }
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(url, download=False)
        if info is None:
            return None
        # Extract basic metadata
        title = info.get('title', 'Unknown Title')
        upload_date = info.get('upload_date', 'Unknown Date')
        uploader = info.get('uploader', 'Unknown Channel')
        return {
            'title': title,
            'upload_date': upload_date,
            'uploader': uploader,
        }

def download_video(url, output_path='output_video.mp4'):
    try:
        with yt_dlp.YoutubeDL({
            'format': 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]',
            'outtmpl': output_path
        }) as ydl:
            ydl.download([url])
        print(f"Downloaded video to {output_path}")
    except Exception as e:
        print(f"Error: {str(e)}")

def download_audio(url, output_path='output_audio.mp3'):
    try:
        with yt_dlp.YoutubeDL({
            'format': 'bestaudio[ext=m4a]/best[ext=mp3]',
            'outtmpl': output_path
        }) as ydl:
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

def download_transcript(url, output_path='transcript.txt', languages=None):
    video_id = extract_video_id(url)
    try:
        # Try new API first
        api = YouTubeTranscriptApi()
        transcript = api.fetch(video_id, languages=languages)
    except AttributeError:
        # Fall back to old API
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
        with open(output_path, 'w', encoding='utf-8') as f:
            # `transcript` is an iterable of FetchedTranscriptSnippet objects in new versions,
            # but older versions may yield dicts. Support both.
            for snippet in transcript:
                try:
                    start = snippet.start
                    duration = snippet.duration or 0
                    text = snippet.text
                except AttributeError:
                    start = snippet.get('start', 0)
                    duration = snippet.get('duration', 0) or 0
                    text = snippet.get('text', '')
                end = (start or 0) + (duration or 0)
                text = (text or '').replace('\n', ' ').strip()
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
        download_transcript(yt_url, transcript_output_path, languages=['en', 'en-US', 'en-GB', 'ko'])
        # download_audio(yt_url, audio_output_path)
    else:
        print("Failed to retrieve video information.")
