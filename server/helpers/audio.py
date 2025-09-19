import os
from typing import Callable, Optional

from .formatting import Fore, Style
from steps.download import download_audio, extract_audio_from_video

ProgressCallback = Callable[[float, str], None]


def ensure_audio(
    yt_url: str,
    audio_out: str,
    video_out: Optional[str] = None,
    *,
    progress_callback: ProgressCallback | None = None,
) -> bool:
    """Try to obtain audio. Prefer direct audio download; if that fails, use existing video file to extract."""
    if os.path.exists(audio_out) and os.path.getsize(audio_out) > 0:
        print(f"{Fore.GREEN}AUDIO: already present -> {audio_out}{Style.RESET_ALL}")
        if progress_callback:
            progress_callback(1.0, "cached")
        return True
    try:
        print(f"{Fore.CYAN}AUDIO: attempting direct audio download -> {audio_out}{Style.RESET_ALL}")
        download_audio(
            yt_url,
            audio_out,
            progress_callback=(
                lambda fraction, _status: progress_callback(fraction, "download")
                if progress_callback
                else None
            ),
        )
        if progress_callback:
            progress_callback(1.0, "download")
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
            if progress_callback:
                progress_callback(0.1, "extract")
            extract_audio_from_video(video_out, audio_out)
            if progress_callback:
                progress_callback(1.0, "extract")
            return True
        except Exception as e2:
            print(f"{Fore.YELLOW}AUDIO: extraction from existing video failed: {e2}{Style.RESET_ALL}")
            return False
