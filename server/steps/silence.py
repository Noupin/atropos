import subprocess
from pathlib import Path
from typing import List, Tuple

from .candidates.helpers import parse_ffmpeg_silences


def detect_silences(audio_path: str | Path,
                    *,
                    noise_level: str = "-30dB",
                    min_silence: float = 0.3) -> List[Tuple[float, float]]:
    """Run ffmpeg's silencedetect filter and return silence ranges.

    Parameters
    ----------
    audio_path: str | Path
        Path to the input audio file.
    noise_level: str
        Threshold passed to ffmpeg's silencedetect noise parameter.
    min_silence: float
        Minimum duration in seconds to qualify as silence.
    """
    cmd = [
        "ffmpeg",
        "-i",
        str(audio_path),
        "-af",
        f"silencedetect=noise={noise_level}:d={min_silence}",
        "-f",
        "null",
        "-",
    ]
    proc = subprocess.run(
        cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True, text=True
    )
    log = proc.stderr
    return parse_ffmpeg_silences(log)
