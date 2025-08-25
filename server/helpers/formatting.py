import colorama
from colorama import Fore, Style

colorama.init(autoreset=True)


def sanitize_filename(title: str) -> str:
    """Return a filesystem-safe version of ``title``."""
    return ''.join(char if char.isalnum() or char in '._-' else '_' for char in title)

__all__ = ["Fore", "Style", "sanitize_filename"]
