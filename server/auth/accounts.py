"""Manage creator account authentication metadata stored in the tokens directory."""

from __future__ import annotations

from contextlib import contextmanager
from datetime import datetime, timezone
import json
from json import JSONDecodeError
import re
import threading
import uuid
import os
import shutil
from pathlib import Path
from typing import Any, Callable, Dict, Iterable, List, Literal, Mapping, MutableMapping, Optional

from fastapi import HTTPException, status
from pydantic import BaseModel, ConfigDict, Field

from config import TOKENS_DIR


SupportedPlatform = Literal["tiktok", "youtube", "instagram"]

AuthHandler = Callable[[Path, Dict[str, Any]], None]


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

PLATFORM_TOKEN_ALIASES: dict[SupportedPlatform, tuple[str, ...]] = {
    "instagram": ("instagram.json",),
}


class PlatformRecord(BaseModel):
    """Metadata for a platform stored on disk."""

    model_config = ConfigDict(alias_generator=_to_camel, populate_by_name=True)

    platform: SupportedPlatform
    label: str | None = None
    added_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    active: bool = True


class AccountMetadata(BaseModel):
    """Persisted account details stored alongside tokens."""

    model_config = ConfigDict(alias_generator=_to_camel, populate_by_name=True)

    id: str
    display_name: str
    description: str | None = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    platforms: List[PlatformRecord] = Field(default_factory=list)
    active: bool = True


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
    active: bool


class AccountResponse(BaseModel):
    """Response payload returned to the renderer."""

    model_config = ConfigDict(alias_generator=_to_camel, populate_by_name=True)

    id: str
    display_name: str
    description: str | None = None
    created_at: datetime
    platforms: List[AccountPlatformStatus]
    active: bool


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


class AccountUpdateRequest(BaseModel):
    """Payload for updating account metadata."""

    model_config = ConfigDict(alias_generator=_to_camel, populate_by_name=True)

    active: bool | None = None


class PlatformUpdateRequest(BaseModel):
    """Payload for updating a platform connection."""

    model_config = ConfigDict(alias_generator=_to_camel, populate_by_name=True)

    active: bool | None = None


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


@contextmanager
def _temporary_env(overrides: Mapping[str, str | None]):
    """Temporarily set environment variables defined in ``overrides``."""

    previous: Dict[str, Optional[str]] = {}
    for key, value in overrides.items():
        previous[key] = os.environ.get(key)
        if value is None:
            os.environ.pop(key, None)
        else:
            os.environ[key] = value
    try:
        yield
    finally:
        for key, value in previous.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value


def _ensure_dir(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)


def _youtube_auth(account_dir: Path, credentials: Dict[str, Any]) -> None:
    """Run the YouTube OAuth flow for ``account_dir``."""

    token_path = account_dir / PLATFORM_TOKEN_FILES["youtube"]
    overrides: Dict[str, str | None] = {
        "YT_TOKENS_FILE": str(token_path),
        "YT_ACCOUNT": account_dir.name,
    }
    try:
        from server.integrations.youtube import auth as youtube_auth
    except ImportError as exc:  # pragma: no cover - import error path
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="YouTube authentication libraries are missing. Install google-auth libraries to continue.",
        ) from exc
    with _temporary_env(overrides):
        youtube_auth.ensure_creds()


def _tiktok_auth(account_dir: Path, credentials: Dict[str, Any]) -> None:
    """Run the TikTok OAuth flow for ``account_dir``."""

    token_path = account_dir / PLATFORM_TOKEN_FILES["tiktok"]
    overrides: Dict[str, str | None] = {
        "TIKTOK_TOKENS_FILE": str(token_path),
    }
    client_key = credentials.get("clientKey")
    client_secret = credentials.get("clientSecret")
    if isinstance(client_key, str) and client_key.strip():
        overrides["TIKTOK_CLIENT_KEY"] = client_key.strip()
    if isinstance(client_secret, str) and client_secret.strip():
        overrides["TIKTOK_CLIENT_SECRET"] = client_secret.strip()
    try:
        from server.integrations.tiktok import auth as tiktok_auth
    except ImportError as exc:  # pragma: no cover - import error path
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="TikTok authentication dependencies are missing. Install requests to continue.",
        ) from exc
    with _temporary_env(overrides):
        tiktok_auth.run()


def _instagram_auth(account_dir: Path, credentials: Dict[str, Any]) -> None:
    """Authenticate Instagram by logging in with the provided credentials."""

    username = credentials.get("username")
    password = credentials.get("password")
    if not isinstance(username, str) or not username.strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Instagram authentication requires a username.",
        )
    if not isinstance(password, str) or not password.strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Instagram authentication requires a password.",
        )
    try:
        from server.integrations.instagram import upload as instagram_auth
    except ImportError as exc:  # pragma: no cover - import error path
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Instagram authentication dependencies are missing. Install instagrapi to continue.",
        ) from exc

    session_path = account_dir / PLATFORM_TOKEN_FILES["instagram"]
    state_path = account_dir / "instagram_state.json"
    client = instagram_auth.build_client(session_path=session_path)
    instagram_auth.login_or_resume(
        client,
        username=username.strip(),
        password=password.strip(),
        session_path=session_path,
    )
    instagram_auth.save_state(
        {"authenticatedAt": datetime.now(timezone.utc).isoformat()},
        path=state_path,
    )


DEFAULT_AUTH_HANDLERS: Mapping[SupportedPlatform, AuthHandler] = {
    "youtube": _youtube_auth,
    "tiktok": _tiktok_auth,
    "instagram": _instagram_auth,
}


class AccountStore:
    """Accesses and mutates account metadata stored under ``TOKENS_DIR``."""

    def __init__(
        self,
        root: Path | str | None = None,
        auth_handlers: Mapping[SupportedPlatform, AuthHandler] | None = None,
    ) -> None:
        self._root = Path(root) if root else TOKENS_DIR
        self._lock = threading.Lock()
        if auth_handlers is None:
            auth_handlers = DEFAULT_AUTH_HANDLERS
        self._auth_handlers: MutableMapping[SupportedPlatform, AuthHandler] = dict(
            auth_handlers
        )

    def _ensure_root(self) -> None:
        _ensure_dir(self._root)

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
            return self._ensure_platform_records(metadata)
        payload = json.loads(metadata_path.read_text(encoding="utf-8"))
        metadata = AccountMetadata.model_validate(payload)
        return self._ensure_platform_records(metadata)

    def _write_metadata(self, metadata: AccountMetadata) -> None:
        account_dir = self._account_dir(metadata.id)
        _ensure_dir(account_dir)
        metadata_path = self._metadata_path(metadata.id)
        with metadata_path.open("w", encoding="utf-8") as handle:
            handle.write(_json_dump(metadata.model_dump(mode="json")))

    def _ensure_platform_records(self, metadata: AccountMetadata) -> AccountMetadata:
        account_id = metadata.id
        existing = {record.platform: record for record in metadata.platforms}
        changed = False
        for platform in SUPPORTED_PLATFORMS:
            if platform in existing:
                continue
            token_path = self._find_token_path(account_id, platform)
            if token_path is None:
                continue
            added_at = datetime.fromtimestamp(
                token_path.stat().st_mtime, tz=timezone.utc
            )
            metadata.platforms.append(
                PlatformRecord(platform=platform, label=None, added_at=added_at)
            )
            changed = True
        if changed:
            self._write_metadata(metadata)
        return metadata

    def _candidate_token_names(self, platform: SupportedPlatform) -> tuple[str, ...]:
        primary = PLATFORM_TOKEN_FILES[platform]
        aliases = PLATFORM_TOKEN_ALIASES.get(platform, ())
        if not aliases:
            return (primary,)
        return (primary, *aliases)

    def _candidate_token_paths(
        self, account_id: str, platform: SupportedPlatform
    ) -> list[Path]:
        account_dir = self._account_dir(account_id)
        return [account_dir / name for name in self._candidate_token_names(platform)]

    def _find_token_path(
        self, account_id: str, platform: SupportedPlatform
    ) -> Path | None:
        for path in self._candidate_token_paths(account_id, platform):
            if path.exists():
                return path
        return None

    def _preferred_token_path(
        self, account_id: str, platform: SupportedPlatform
    ) -> Path:
        existing = self._find_token_path(account_id, platform)
        if existing is not None:
            return existing
        return self._candidate_token_paths(account_id, platform)[0]

    def _token_is_valid(self, token_path: Path) -> bool:
        try:
            raw = token_path.read_text(encoding="utf-8")
        except OSError:
            return False
        if raw.strip() == "":
            return False
        try:
            json.loads(raw)
        except JSONDecodeError:
            return False
        return True

    def _build_platform_status(
        self, account: AccountMetadata, record: PlatformRecord
    ) -> AccountPlatformStatus:
        account_id = account.id
        token_path = self._find_token_path(account_id, record.platform)
        connected = False
        path_str: str | None = None
        last_verified: datetime | None = None
        if token_path is not None and record.active and account.active:
            path_str = str(token_path)
            last_verified = datetime.fromtimestamp(
                token_path.stat().st_mtime, tz=timezone.utc
            )
            connected = self._token_is_valid(token_path)
        label = record.label or PLATFORM_LABELS[record.platform]
        if not account.active or not record.active:
            status_value = "disabled"
            connected = False
        else:
            status_value = "active" if connected else "disconnected"
        return AccountPlatformStatus(
            platform=record.platform,
            label=label,
            status=status_value,
            connected=connected,
            token_path=path_str,
            added_at=record.added_at,
            last_verified_at=last_verified,
            active=account.active and record.active,
        )

    def _render_account(self, metadata: AccountMetadata) -> AccountResponse:
        platforms = [
            self._build_platform_status(metadata, record)
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
            active=metadata.active,
        )

    def _get_auth_handler(self, platform: SupportedPlatform) -> AuthHandler:
        handler = self._auth_handlers.get(platform)
        if handler is None:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"No authentication handler configured for platform '{platform}'.",
            )
        return handler

    def _authenticate_platform(
        self, account_id: str, platform: SupportedPlatform, credentials: Dict[str, Any]
    ) -> None:
        handler = self._get_auth_handler(platform)
        account_dir = self._account_dir(account_id)
        _ensure_dir(account_dir)
        handler(account_dir, credentials)
        token_path = self._find_token_path(account_id, platform)
        if token_path is None or not self._token_is_valid(token_path):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Authentication for '{platform}' did not produce valid credentials.",
            )

    def _generate_unique_id(self, display_name: str) -> str:
        base = _slugify(display_name)
        candidate = base
        suffix = 1
        while self._account_dir(candidate).exists():
            candidate = f"{base}-{suffix}" if suffix > 1 else f"{base}-1"
            suffix += 1
        return candidate

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
        try:
            self._authenticate_platform(account_id, platform, credentials)
        except Exception:
            with self._lock:
                metadata = self._load_metadata(account_id)
                metadata.platforms = [
                    item for item in metadata.platforms if item.platform != platform
                ]
                self._write_metadata(metadata)
            raise
        with self._lock:
            metadata = self._load_metadata(account_id)
        return self._render_account(metadata)

    def update_account(self, account_id: str, payload: AccountUpdateRequest) -> AccountResponse:
        with self._lock:
            metadata = self._load_metadata(account_id)
            if payload.active is not None:
                metadata.active = payload.active
            self._write_metadata(metadata)
        return self._render_account(metadata)

    def remove_account(self, account_id: str) -> None:
        with self._lock:
            metadata = self._load_metadata(account_id)
            account_dir = self._account_dir(metadata.id)
            if account_dir.exists():
                shutil.rmtree(account_dir, ignore_errors=True)

    def update_platform(
        self, account_id: str, platform: SupportedPlatform, payload: PlatformUpdateRequest
    ) -> AccountResponse:
        with self._lock:
            metadata = self._load_metadata(account_id)
            for record in metadata.platforms:
                if record.platform == platform:
                    if payload.active is not None:
                        record.active = payload.active
                    self._write_metadata(metadata)
                    break
            else:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=f"Platform '{platform}' is not connected to this account.",
                )
        return self._render_account(metadata)

    def remove_platform(self, account_id: str, platform: SupportedPlatform) -> AccountResponse:
        with self._lock:
            metadata = self._load_metadata(account_id)
            original_len = len(metadata.platforms)
            metadata.platforms = [
                record for record in metadata.platforms if record.platform != platform
            ]
            if len(metadata.platforms) == original_len:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=f"Platform '{platform}' is not connected to this account.",
                )
            self._write_metadata(metadata)
            account_dir = self._account_dir(account_id)
            for path in self._candidate_token_paths(account_id, platform):
                if path.exists():
                    path.unlink()
            if platform == "instagram":
                state_path = account_dir / "instagram_state.json"
                if state_path.exists():
                    state_path.unlink()
        return self._render_account(metadata)

    def get_account(self, account_id: str) -> AccountResponse:
        metadata = self._load_metadata(account_id)
        return self._render_account(metadata)

    def describe_platforms(self, accounts: Iterable[AccountResponse]) -> tuple[int, int]:
        total = 0
        connected = 0
        for account in accounts:
            if not account.active:
                continue
            for platform in account.platforms:
                if not platform.active:
                    continue
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


def update_account(account_id: str, payload: AccountUpdateRequest) -> AccountResponse:
    return _store.update_account(account_id, payload)


def delete_account(account_id: str) -> None:
    _store.remove_account(account_id)


def update_platform(
    account_id: str, platform: SupportedPlatform, payload: PlatformUpdateRequest
) -> AccountResponse:
    return _store.update_platform(account_id, platform, payload)


def delete_platform(account_id: str, platform: SupportedPlatform) -> AccountResponse:
    return _store.remove_platform(account_id, platform)


def get_account(account_id: str) -> AccountResponse:
    return _store.get_account(account_id)


def ensure_account_available(account_id: str) -> AccountResponse:
    account = _store.get_account(account_id)
    if not account.active:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Account '{account.display_name}' is disabled.",
        )
    active_platforms = [platform for platform in account.platforms if platform.active]
    if not active_platforms:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="The selected account does not have any active platforms.",
        )
    return account


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

