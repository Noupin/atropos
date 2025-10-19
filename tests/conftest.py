"""Test configuration helpers for import path setup."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SERVER_ROOT = ROOT / "server"

root_path = str(ROOT)
server_path = str(SERVER_ROOT)

if root_path not in sys.path:
    sys.path.insert(0, root_path)
if server_path not in sys.path:
    sys.path.insert(0, server_path)
