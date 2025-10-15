import os
import os
import subprocess
from pathlib import Path
from typing import Any, Callable, Optional

from .formatting import Fore, Style
from steps.download import download_audio, extract_audio_from_video

ProgressCallback = Callable[[float, str, dict[str, Any] | None], None]


def ensure_audio(
    yt_url: str | None,
    audio_out: str,
    video_out: Optional[str] = None,
    *,
    progress_callback: ProgressCallback | None = None,
) -> bool:
    """Try to obtain audio. Prefer direct audio download; if that fails, use existing video file to extract."""
    target_path = Path(audio_out)
    if target_path.exists() and target_path.stat().st_size > 0:
        print(f"{Fore.GREEN}AUDIO: already present -> {audio_out}{Style.RESET_ALL}")
        if progress_callback:
            progress_callback(1.0, "cached", None)
        return True
    download_path: Path | None = None

    if yt_url:
        try:
            print(f"{Fore.CYAN}AUDIO: attempting direct audio download -> {audio_out}{Style.RESET_ALL}")
            download_path = target_path.with_suffix(target_path.suffix + '.download')
            download_audio(
                yt_url,
                str(download_path),
                progress_callback=(
                    lambda fraction, status: progress_callback(fraction, 'download', status)
                    if progress_callback
                    else None
                ),
            )
            _convert_to_pcm(str(download_path), audio_out)
            if progress_callback:
                progress_callback(1.0, 'download', None)
            return True
        except Exception as error:
            print(f"{Fore.YELLOW}AUDIO: direct audio download failed: {error}{Style.RESET_ALL}")
        finally:
            if download_path and download_path.exists():
                download_path.unlink(missing_ok=True)
    else:
        print(f"{Fore.YELLOW}AUDIO: skipping direct download because no URL was provided.{Style.RESET_ALL}")

    if not video_out:
        print(f"{Fore.YELLOW}AUDIO: no video path provided for fallback extract.{Style.RESET_ALL}")
        return False
    if not os.path.exists(video_out) or os.path.getsize(video_out) == 0:
        print(f"{Fore.YELLOW}AUDIO: fallback requires existing video from STEP 1; none found.{Style.RESET_ALL}")
        return False

    try:
        print(f"{Fore.CYAN}AUDIO: extracting audio from existing video {video_out} -> {audio_out}{Style.RESET_ALL}")
        if progress_callback:
            progress_callback(0.1, 'extract', None)
        extract_audio_from_video(video_out, audio_out)
        if progress_callback:
            progress_callback(1.0, 'extract', None)
        return True
    except Exception as error:
        print(f"{Fore.YELLOW}AUDIO: extraction from existing video failed: {error}{Style.RESET_ALL}")
        return False


def _convert_to_pcm(source_path: str, target_path: str) -> None:
    destination = Path(target_path)
    destination.parent.mkdir(parents=True, exist_ok=True)
    temp_output = destination.with_suffix(destination.suffix + '.tmp')
    try:
        subprocess.run(
            [
                'ffmpeg',
                '-y',
                '-i',
                source_path,
                '-vn',
                '-acodec',
                'pcm_s16le',
                '-ar',
                '16000',
                '-ac',
                '1',
                str(temp_output),
            ],
            check=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        os.replace(temp_output, destination)
    finally:
        if temp_output.exists():
            temp_output.unlink(missing_ok=True)
