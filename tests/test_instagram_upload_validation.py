from __future__ import annotations

from pathlib import Path

import pytest
from pydantic import BaseModel, ValidationError

from server.integrations.instagram.upload import clip_upload_with_retries


class _DummyModel(BaseModel):
    value: int


def _make_validation_error() -> ValidationError:
    with pytest.raises(ValidationError) as excinfo:
        _DummyModel(value="not-an-int")
    return excinfo.value


class _ClientStub:
    def __init__(self, error: ValidationError) -> None:
        self._error = error
        self.call_count = 0
        self.last_json = {
            "status": "ok",
            "media": {"pk": "123", "code": "Cabc123", "id": "123_456"},
        }

    def clip_upload(self, path: str, caption: str, extra_data: dict | None = None):
        self.call_count += 1
        raise self._error


def test_clip_upload_returns_configured_media_on_validation_error(tmp_path: Path) -> None:
    video = tmp_path / "video.mp4"
    video.write_bytes(b"data")

    client = _ClientStub(_make_validation_error())

    result = clip_upload_with_retries(client, video, "caption", "user", "pass")

    assert result == {"status": "ok", "pk": "123", "code": "Cabc123", "id": "123_456"}
    assert client.call_count == 1
