"""Tests for filename sanitization."""

from server.helpers.formatting import sanitize_filename


def test_sanitize_filename_replaces_unsafe_chars() -> None:
    """Unsafe characters should be replaced with underscores."""
    unsafe = "bad: file/name?.txt"
    assert sanitize_filename(unsafe) == "bad__file_name_.txt"
