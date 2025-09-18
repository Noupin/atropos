"""Manage creator account authentication metadata stored in the tokens directory."""

from __future__ import annotations

from datetime import datetime, timezone
import json
import re
import threading
import uuid
from pathlib import Path
from typing import Any, Dict, Iterable, List, Literal

from fastapi import HTTPException, status
from pydantic import BaseModel, ConfigDict, Field

from server.config import TOKENS_DIR


SupportedPlatform = Literal["tiktok", "youtube", "instagram"]


def _to_camel(value: str) -> str:
    parts = value.split("_")
    return parts[0] + "".join(part.title() for part in parts[1:])


SUPPORTED_PLATFORMS: tuple[SupportedPlatform, ...] = ("tiktok", "youtube", "instagram")

PLATFORM_LABELS: dict[SupportedPlatform, str] = {
    "tiktok": "TikTok",
    "youtube": "YouTube",
    "instagram": "Instagram",
}

PLATFORM_TOKEN_FILES: dict[SupportedPlatform, str] = {
    "tiktok": "tiktok.json",
    "youtube": "youtube.json",
    "instagram": "instagram_session.json",
}


class PlatformRecord(BaseModel):
    """Metadata for a platform stored on disk."""

    model_config = ConfigDict(alias_generator=_to_camel, populate_by_name=True)

    platform: SupportedPlatform
    label: str | None = None
    added_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class AccountMetadata(BaseModel):
    """Persisted account details stored alongside tokens."""

    model_config = ConfigDict(alias_generator=_to_camel, populate_by_name=True)

    id: str
    display_name: str
    description: str | None = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    platforms: List[PlatformRecord] = Field(default_factory=list)


class AccountPlatformStatus(BaseModel):
    """Runtime status of a connected platform."""

    model_config = ConfigDict(alias_generator=_to_camel, populate_by_name=True)

    platform: SupportedPlatform
    label: str
    status: str
    connected: bool
    token_path: str | None = None
    added_at: datetime
    last_verified_at: datetime | None = None


class AccountResponse(BaseModel):
    """Response payload returned to the renderer."""

    model_config = ConfigDict(alias_generator=_to_camel, populate_by_name=True)

    id: str
    display_name: str
    description: str | None = None
    created_at: datetime
    platforms: List[AccountPlatformStatus]


class AccountCreateRequest(BaseModel):
    """Request payload for creating a new account."""

    model_config = ConfigDict(alias_generator=_to_camel, populate_by_name=True)

    display_name: str = Field(..., min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=500)


class PlatformCreateRequest(BaseModel):
    """Request payload for adding a platform to an account."""

    model_config = ConfigDict(alias_generator=_to_camel, populate_by_name=True)

    platform: SupportedPlatform
    label: str | None = Field(default=None, max_length=120)
    credentials: Dict[str, Any] = Field(default_factory=dict)


class AuthPingResponse(BaseModel):
    """Returned when checking overall authentication health."""

    model_config = ConfigDict(alias_generator=_to_camel, populate_by_name=True)

    status: str
    checked_at: datetime
    accounts: int
    connected_platforms: int
    total_platforms: int
    message: str


def _slugify(value: str) -> str:
    cleaned = value.strip().lower()
    cleaned = re.sub(r"[^a-z0-9]+", "-", cleaned)
    cleaned = cleaned.strip("-")
    return cleaned or uuid.uuid4().hex


def _normalise_name(value: str) -> str:
    return re.sub(r"\s+", " ", value.strip())


def _json_dump(data: Any) -> str:
    return json.dumps(data, indent=2, ensure_ascii=False)


class AccountStore:
    """Accesses and mutates account metadata stored under ``TOKENS_DIR``."""

    def __init__(self, root: Path | str | None = None) -> None:
        self._root = Path(root) if root else TOKENS_DIR
        self._lock = threading.Lock()

    def _ensure_root(self) -> None:
        self._root.mkdir(parents=True, exist_ok=True)

    def _account_dir(self, account_id: str) -> Path:
        return self._root / account_id

    def _metadata_path(self, account_id: str) -> Path:
        return self._account_dir(account_id) / "account.json"

    def _load_metadata(self, account_id: str) -> AccountMetadata:
        metadata_path = self._metadata_path(account_id)
        if not metadata_path.exists():
            account_dir = self._account_dir(account_id)
            if not account_dir.exists():
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=f"Account '{account_id}' was not found.",
                )
            metadata = AccountMetadata(id=account_id, display_name=account_id)
            self._write_metadata(metadata)
            return metadata
        payload = json.loads(metadata_path.read_text(encoding="utf-8"))
        return AccountMetadata.model_validate(payload)

    def _write_metadata(self, metadata: AccountMetadata) -> None:
        account_dir = self._account_dir(metadata.id)
        account_dir.mkdir(parents=True, exist_ok=True)
        metadata_path = self._metadata_path(metadata.id)
        with metadata_path.open("w", encoding="utf-8") as handle:
            handle.write(_json_dump(metadata.model_dump(mode="json")))

    def _build_platform_status(
        self, account_id: str, record: PlatformRecord
    ) -> AccountPlatformStatus:
        account_dir = self._account_dir(account_id)
        token_name = PLATFORM_TOKEN_FILES[record.platform]
        token_path = account_dir / token_name
        connected = token_path.exists()
        last_verified: datetime | None = None
        if connected:
            last_verified = datetime.fromtimestamp(
                token_path.stat().st_mtime, tz=timezone.utc
            )
        label = record.label or PLATFORM_LABELS[record.platform]
        status_value = "active" if connected else "disconnected"
        return AccountPlatformStatus(
            platform=record.platform,
            label=label,
            status=status_value,
            connected=connected,
            token_path=str(token_path) if connected else None,
            added_at=record.added_at,
            last_verified_at=last_verified,
        )

    def _render_account(self, metadata: AccountMetadata) -> AccountResponse:
        platforms = [
            self._build_platform_status(metadata.id, record)
            for record in metadata.platforms
            if record.platform in SUPPORTED_PLATFORMS
        ]
        platforms.sort(key=lambda item: PLATFORM_LABELS[item.platform])
        return AccountResponse(
            id=metadata.id,
            display_name=metadata.display_name,
            description=metadata.description,
            created_at=metadata.created_at,
            platforms=platforms,
        )

    def _generate_unique_id(self, display_name: str) -> str:
        base = _slugify(display_name)
        candidate = base
        suffix = 1
        while self._account_dir(candidate).exists():
            candidate = f"{base}-{suffix}" if suffix > 1 else f"{base}-1"
            suffix += 1
        return candidate

    def _persist_credentials(self, account_id: str, platform: SupportedPlatform, credentials: Dict[str, Any]) -> None:
        account_dir = self._account_dir(account_id)
        account_dir.mkdir(parents=True, exist_ok=True)
        token_name = PLATFORM_TOKEN_FILES[platform]
        token_path = account_dir / token_name
        payload: Dict[str, Any]
        if credentials:
            payload = credentials
        else:
            payload = {"connectedAt": datetime.now(timezone.utc).isoformat()}
        token_path.write_text(_json_dump(payload), encoding="utf-8")
        if platform == "instagram":
            state_path = account_dir / "instagram_state.json"
            if not state_path.exists():
                state_payload = {"updatedAt": datetime.now(timezone.utc).isoformat()}
                state_path.write_text(_json_dump(state_payload), encoding="utf-8")

    def list_accounts(self) -> List[AccountResponse]:
        self._ensure_root()
        accounts: List[AccountResponse] = []
        for entry in sorted(self._root.iterdir(), key=lambda path: path.name):
            if not entry.is_dir():
                continue
            account_id = entry.name
            metadata = self._load_metadata(account_id)
            accounts.append(self._render_account(metadata))
        return accounts

    def create_account(self, payload: AccountCreateRequest) -> AccountResponse:
        name = _normalise_name(payload.display_name)
        if not name:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Display name is required.")
        description = payload.description.strip() if payload.description else None
        with self._lock:
            account_id = self._generate_unique_id(name)
            metadata = AccountMetadata(id=account_id, display_name=name, description=description)
            self._write_metadata(metadata)
        return self._render_account(metadata)

    def add_platform(self, account_id: str, payload: PlatformCreateRequest) -> AccountResponse:
        platform = payload.platform
        if platform not in SUPPORTED_PLATFORMS:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Platform '{platform}' is not supported.",
            )
        credentials = payload.credentials
        with self._lock:
            metadata = self._load_metadata(account_id)
            if any(record.platform == platform for record in metadata.platforms):
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=f"Platform '{platform}' is already connected to this account.",
                )
            record = PlatformRecord(
                platform=platform,
                label=_normalise_name(payload.label) if payload.label else None,
            )
            metadata.platforms.append(record)
            self._write_metadata(metadata)
            self._persist_credentials(account_id, platform, credentials)
        return self._render_account(metadata)

    def describe_platforms(self, accounts: Iterable[AccountResponse]) -> tuple[int, int]:
        total = 0
        connected = 0
        for account in accounts:
            for platform in account.platforms:
                total += 1
                if platform.connected:
                    connected += 1
        return connected, total


_store = AccountStore()


def set_account_store(store: AccountStore) -> None:
    """Override the global account store (primarily for tests)."""

    global _store
    _store = store


def list_accounts() -> List[AccountResponse]:
    return _store.list_accounts()


def create_account(payload: AccountCreateRequest) -> AccountResponse:
    return _store.create_account(payload)


def add_platform(account_id: str, payload: PlatformCreateRequest) -> AccountResponse:
    return _store.add_platform(account_id, payload)


def ping_authentication() -> AuthPingResponse:
    accounts = _store.list_accounts()
    connected, total = _store.describe_platforms(accounts)
    status_value = "ok"
    message = "All connected platforms look healthy."
    if total > 0 and connected < total:
        status_value = "degraded"
        message = "Some platforms require authentication before publishing."
    timestamp = datetime.now(timezone.utc)
    return AuthPingResponse(
        status=status_value,
        checked_at=timestamp,
        accounts=len(accounts),
        connected_platforms=connected,
        total_platforms=total,
        message=message,
    )

