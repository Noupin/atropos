import yt_dlp
import subprocess
import logging
from youtube_transcript_api import YouTubeTranscriptApi
from youtube_transcript_api._errors import NoTranscriptFound, TranscriptsDisabled


logger = logging.getLogger(__name__)

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
        # Extract video title and upload date
        title = info.get('title', 'Unknown Title')
        upload_date = info.get('upload_date', 'Unknown Date')
        return {
            'title': title,
            'upload_date': upload_date
        }

def download_video(url, output_path='output_video.mp4'):
    try:
        with yt_dlp.YoutubeDL({
            'format': 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]',
            'outtmpl': output_path
        }) as ydl:
            ydl.download([url])
        logger.info("Downloaded video to %s", output_path)
    except Exception as e:
        logger.error("Error: %s", str(e))

def download_audio(url, output_path='output_audio.mp3'):
    try:
        with yt_dlp.YoutubeDL({
            'format': 'bestaudio[ext=m4a]/best[ext=mp3]',
            'outtmpl': output_path
        }) as ydl:
            ydl.download([url])
        logger.info("Downloaded audio to %s", output_path)
    except Exception as e:
        logger.error("Error: %s", str(e))

def extract_audio_from_video(video_path, audio_output_path='extracted_audio.mp3'):
    try:
        # Use ffmpeg to extract audio from the video file
        subprocess.run(
            ['ffmpeg', '-i', video_path, '-vn', '-acodec', 'libmp3lame', audio_output_path],
            check=True
        )
        logger.info("Extracted audio to %s", audio_output_path)
    except Exception as e:
        logger.error("Error: %s", str(e))

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
            logger.error("TRANSCRIPT: No transcript found for this video.")
            return False
        except TranscriptsDisabled:
            logger.error("TRANSCRIPT: Transcripts are disabled for this video.")
            return False
    except NoTranscriptFound:
        logger.error("TRANSCRIPT: No transcript found for this video.")
        return False
    except TranscriptsDisabled:
        logger.error("TRANSCRIPT: Transcripts are disabled for this video.")
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
        logger.info("TRANSCRIPT: Downloaded transcript to %s", output_path)
        return True
    except Exception as e:
        logger.error("TRANSCRIPT: Error writing transcript: %s", str(e))
        return False

def main(yt_url: str = 'https://www.youtube.com/watch?v=GDbDRWzFfds') -> None:
    video_info = get_video_info(yt_url)
    if video_info:
        title = video_info['title']
        upload_date = video_info['upload_date']
        sanitized_title = ''.join(char if char.isalnum() or char in '._-' else '_' for char in title)
        if len(upload_date) == 8:
            upload_date = upload_date[:4] + upload_date[4:6] + upload_date[6:]
        else:
            upload_date = 'Unknown_Date'
        video_output_path = f"{sanitized_title}_{upload_date}.mp4"
        audio_output_path = f"{sanitized_title}_{upload_date}.mp3"
        transcript_output_path = f"{sanitized_title}_{upload_date}_transcript.txt"
        logger.info("Video title: %s", title)
        logger.info("Upload date: %s", upload_date)
        logger.info("Saving video as: %s", video_output_path)
        logger.info("Saving audio as: %s", audio_output_path)
        # download_video(yt_url, video_output_path)
        # extract_audio_from_video(video_output_path, audio_output_path)
        download_transcript(yt_url, transcript_output_path, languages=['en', 'en-US', 'en-GB', 'ko'])
        # download_audio(yt_url, audio_output_path)
    else:
        logger.error("Failed to retrieve video information.")


if __name__ == "__main__":  # pragma: no cover
    main()
