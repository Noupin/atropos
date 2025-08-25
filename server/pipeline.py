from server.steps.transcribe import transcribe_audio
from server.steps.download import download_transcript, download_video, get_video_info

import os
import sys

from server.helpers.audio import ensure_audio
from server.helpers.transcript import write_transcript_txt
from server.helpers.formatting import Fore, Style, sanitize_filename


if __name__ == "__main__":
    yt_url = 'https://www.youtube.com/watch?v=GDbDRWzFfds'
    # yt_url = input("Enter YouTube video URL: ")
    video_info = get_video_info(yt_url)

    if not video_info:
        print(f"{Fore.RED}Failed to retrieve video information.{Style.RESET_ALL}")
        sys.exit()

    upload_date = video_info['upload_date']
    sanitized_title = sanitize_filename(video_info['title'])
    if len(upload_date) == 8:
        upload_date = upload_date[:4] + upload_date[4:6] + upload_date[6:]
    else:
        upload_date = 'Unknown_Date'
    non_suffix_filename = f"{sanitized_title}_{upload_date}"
    print(f"File Name: {non_suffix_filename}")

    # ----------------------
    # STEP 1: Download Video
    # ----------------------
    video_output_path = f"{non_suffix_filename}.mp4"
    try:
        if os.path.exists(video_output_path) and os.path.getsize(video_output_path) > 0:
            print(f"{Fore.GREEN}STEP 1: Video already present -> {video_output_path}{Style.RESET_ALL}")
        else:
            print(f"{Fore.CYAN}STEP 1: Downloading video -> {video_output_path}{Style.RESET_ALL}")
            download_video(yt_url, video_output_path)
    except Exception as e:
        print(f"{Fore.RED}STEP 1: Video download failed: {e}{Style.RESET_ALL}")

    # ----------------------
    # STEP 2: Acquire Audio
    # ----------------------
    audio_output_path = f"{non_suffix_filename}.mp3"
    print(f"{Fore.CYAN}STEP 2: Ensuring audio -> {audio_output_path}{Style.RESET_ALL}")
    audio_ok = ensure_audio(yt_url, audio_output_path, video_output_path)
    if not audio_ok:
        print(f"{Fore.YELLOW}STEP 2: Failed to acquire audio (direct + video-extract fallbacks tried).{Style.RESET_ALL}")

    # ----------------------
    # STEP 3: Get Text (Transcript or Transcription)
    # ----------------------
    transcript_output_path = f"{non_suffix_filename}.txt"
    print(f"{Fore.CYAN}STEP 3: Attempting YouTube transcript -> {transcript_output_path}{Style.RESET_ALL}")
    yt_ok = download_transcript(yt_url, transcript_output_path, languages=['en', 'en-US', 'en-GB', 'ko'])
    if yt_ok:
        print(f"{Fore.GREEN}STEP 3: Used YouTube transcript.{Style.RESET_ALL}")
    else:
        if not audio_ok:
            print(f"{Fore.RED}STEP 3: Cannot transcribe because audio acquisition failed.{Style.RESET_ALL}")
        else:
            print(f"{Fore.CYAN}STEP 3: Transcribing with faster-whisper (large-v3-turbo)...{Style.RESET_ALL}")
            result = transcribe_audio(audio_output_path, model_size="large-v3-turbo")
            write_transcript_txt(result, transcript_output_path)
            print(f"{Fore.GREEN}STEP 3: Transcription saved -> {transcript_output_path}{Style.RESET_ALL}")
