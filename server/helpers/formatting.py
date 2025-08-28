import colorama
from colorama import Fore, Style

colorama.init(autoreset=True)


def sanitize_filename(title: str) -> str:
    """Return a filesystem-safe version of ``title``."""
    return ''.join(char if char.isalnum() or char in '._-' else '_' for char in title)


def youtube_timestamp_url(url: str, start: float) -> str:
    """Return the given YouTube ``url`` with a timestamp for ``start`` seconds."""
    delimiter = '&' if '?' in url else '?'
    seconds = int(round(start))
    return f"{url}{delimiter}t={seconds}s"

__all__ = ["Fore", "Style", "sanitize_filename", "youtube_timestamp_url"]
