from transcribe import transcribe_audio
from download import download_audio, download_transcript, download_video, extract_audio_from_video, get_video_info

import os
import sys
import colorama
from typing import Optional
from colorama import Fore, Style

colorama.init(autoreset=True)

def write_transcript_txt(result: dict, out_path: str) -> None:
    """Write segments and timing from transcribe_audio result to a .txt file."""
    segments = result.get("segments", [])
    timing = result.get("timing", {})
    with open(out_path, "w", encoding="utf-8") as f:
        for seg in segments:
            start = float(seg.get("start", 0.0))
            end = float(seg.get("end", 0.0))
            text = (seg.get("text", "") or "").replace("\n", " ").strip()
            f.write(f"[{start:.2f} -> {end:.2f}] {text}\n")
        f.write("\n# TIMING\n")
        f.write(f"start_time: {timing.get('start_time', 0.0):.2f} seconds\n")
        f.write(f"stop_time: {timing.get('stop_time', 0.0):.2f} seconds\n")
        f.write(f"total_time: {timing.get('total_time', 0.0):.2f} seconds\n")

def ensure_audio(yt_url: str, audio_out: str, video_out: Optional[str] = None) -> bool:
    """Try to obtain audio. Prefer direct audio download; if that fails, use existing video file to extract."""
    if os.path.exists(audio_out) and os.path.getsize(audio_out) > 0:
        print(f"{Fore.GREEN}AUDIO: already present -> {audio_out}{Style.RESET_ALL}")
        return True
    try:
        print(f"{Fore.CYAN}AUDIO: attempting direct audio download -> {audio_out}{Style.RESET_ALL}")
        download_audio(yt_url, audio_out)
        return True
    except Exception as e:
        print(f"{Fore.YELLOW}AUDIO: direct audio download failed: {e}{Style.RESET_ALL}")
        if not video_out:
            print(f"{Fore.YELLOW}AUDIO: no video path provided for fallback extract.{Style.RESET_ALL}")
            return False
        if not os.path.exists(video_out) or os.path.getsize(video_out) == 0:
            print(f"{Fore.YELLOW}AUDIO: fallback requires existing video from STEP 1; none found.{Style.RESET_ALL}")
            return False
        try:
            print(f"{Fore.CYAN}AUDIO: extracting audio from existing video {video_out} -> {audio_out}{Style.RESET_ALL}")
            extract_audio_from_video(video_out, audio_out)
            return True
        except Exception as e2:
            print(f"{Fore.YELLOW}AUDIO: extraction from existing video failed: {e2}{Style.RESET_ALL}")
            return False


if __name__ == "__main__":
    yt_url = 'https://www.youtube.com/watch?v=GDbDRWzFfds'
    # yt_url = input("Enter YouTube video URL: ")
    video_info = get_video_info(yt_url)
    
    if not video_info:
        print(f"{Fore.RED}Failed to retrieve video information.{Style.RESET_ALL}")
        sys.exit()

    upload_date = video_info['upload_date']
    # Sanitize the title to make it file system safe
    sanitized_title = ''.join(char if char.isalnum() or char in '._-' else '_' for char in video_info['title'])
    # Ensure the upload date is in the correct format (YYYYMMDD)
    if len(upload_date) == 8:
        upload_date = upload_date[:4] + upload_date[4:6] + upload_date[6:]
    else:
        upload_date = 'Unknown_Date'
    # Create safe file names
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
