import string
from typing import List


def score_transcript_quality(text: str) -> float:
    """Return a heuristic quality score in [0,1] for a transcript.

    The score is the average of four boolean heuristics:
    - average token length >= 3 characters
    - punctuation density >= 1% of characters
    - non-alphanumeric character ratio <= 20%
    - type/token ratio (unique words / total words) >= 0.3
    """
    if not text:
        return 0.0
    tokens: List[str] = text.split()
    if not tokens:
        return 0.0
    avg_token_len = sum(len(t) for t in tokens) / len(tokens)
    punct_count = sum(1 for c in text if c in string.punctuation)
    punct_density = punct_count / max(len(text), 1)
    non_alnum_ratio = (
        sum(1 for c in text if not (c.isalnum() or c.isspace()))
        / max(len(text), 1)
    )
    unique_tokens = {t.lower() for t in tokens}
    type_token_ratio = len(unique_tokens) / len(tokens)

    checks = [
        avg_token_len >= 3,
        punct_density >= 0.01,
        non_alnum_ratio <= 0.2,
        type_token_ratio >= 0.3,
    ]
    return sum(checks) / len(checks)
