from __future__ import annotations

import json
import re
from typing import Optional


def parse_compact_number(text: str) -> Optional[int]:
    if not text:
        return None
    cleaned = text.replace("\u00a0", " ").strip()
    match = re.search(r"([0-9]+(?:[.,][0-9]+)?)\s*([KMB]?)", cleaned, re.IGNORECASE)
    if not match:
        digits = re.sub(r"[^0-9]", "", cleaned)
        if digits:
            return int(digits)
        return None
    number_token = match.group(1)
    suffix = match.group(2).upper()
    if suffix:
        normalized_token = number_token.replace(",", ".")
        try:
            numeric = float(normalized_token)
        except ValueError:
            digits = re.sub(r"[^0-9]", "", normalized_token)
            if not digits:
                return None
            numeric = float(digits)
    else:
        comma_count = number_token.count(",")
        dot_count = number_token.count(".")
        if comma_count > 1 or dot_count > 1 or (comma_count and dot_count):
            digits = re.sub(r"[^0-9]", "", number_token)
            if not digits:
                return None
            numeric = float(digits)
        elif comma_count == 1 and dot_count == 0:
            decimals = number_token.split(",", 1)[1]
            if len(decimals) == 3 and decimals.isdigit():
                numeric = float(number_token.replace(",", ""))
            else:
                numeric = float(number_token.replace(",", "."))
        elif dot_count == 1 and comma_count == 0:
            decimals = number_token.split(".", 1)[1]
            if len(decimals) == 3 and decimals.isdigit():
                numeric = float(number_token.replace(".", ""))
            else:
                numeric = float(number_token)
        else:
            digits = re.sub(r"[^0-9]", "", number_token)
            if not digits:
                return None
            numeric = float(digits)
    multiplier = 1
    if suffix == "K":
        multiplier = 1_000
    elif suffix == "M":
        multiplier = 1_000_000
    elif suffix == "B":
        multiplier = 1_000_000_000
    return int(round(numeric * multiplier))


def extract_json_blob(html: str, regex: re.Pattern[str]) -> Optional[dict]:
    match = regex.search(html)
    if not match:
        return None
    blob = match.group(1)
    try:
        return json.loads(blob)
    except json.JSONDecodeError:
        return None
