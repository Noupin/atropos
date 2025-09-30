"""Helpers for verifying Ed25519-signed JSON Web Tokens."""

from __future__ import annotations

import json
from base64 import urlsafe_b64decode
from dataclasses import dataclass
from typing import Any, Mapping

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey


class JwtVerificationError(ValueError):
    """Raised when a JWT fails validation."""


@dataclass(frozen=True, slots=True)
class JwtSegments:
    """Decoded header and payload segments from a JWT."""

    header: dict[str, Any]
    payload: dict[str, Any]


def _add_base64_padding(value: str) -> str:
    remainder = len(value) % 4
    if remainder == 0:
        return value
    return value + "=" * (4 - remainder)


def _decode_segment(segment: str) -> dict[str, Any]:
    try:
        decoded = urlsafe_b64decode(_add_base64_padding(segment))
    except (ValueError, TypeError) as exc:  # pragma: no cover - defensive guard
        raise JwtVerificationError("Invalid JWT segment encoding") from exc

    try:
        parsed = json.loads(decoded.decode("utf-8"))
    except (ValueError, UnicodeDecodeError) as exc:
        raise JwtVerificationError("Invalid JWT segment payload") from exc

    if not isinstance(parsed, dict):
        raise JwtVerificationError("JWT segment must decode to an object")

    return parsed


def decode_jwt_segments(token: str) -> JwtSegments:
    """Decode the header and payload segments of ``token``.

    Parameters
    ----------
    token:
        JWT string in ``header.payload.signature`` form.
    """

    parts = token.split(".")
    if len(parts) != 3:
        raise JwtVerificationError("Invalid token format")

    header_segment, payload_segment, _ = parts
    header = _decode_segment(header_segment)
    payload = _decode_segment(payload_segment)
    return JwtSegments(header=header, payload=payload)


def load_ed25519_public_key(value: str | Mapping[str, Any]) -> Ed25519PublicKey:
    """Load an Ed25519 public key from a JWK string or mapping."""

    if isinstance(value, str):
        try:
            data = json.loads(value)
        except json.JSONDecodeError as exc:
            raise ValueError("Public key must be a JSON Web Key string") from exc
    else:
        data = dict(value)

    kty = data.get("kty")
    crv = data.get("crv")
    if kty != "OKP" or crv != "Ed25519":
        raise ValueError("Public key must be an Ed25519 OKP JWK")

    x = data.get("x")
    if not isinstance(x, str) or not x:
        raise ValueError("Public key JWK must include the 'x' coordinate")

    try:
        public_bytes = urlsafe_b64decode(_add_base64_padding(x))
    except (ValueError, TypeError) as exc:  # pragma: no cover - defensive guard
        raise ValueError("Invalid Ed25519 public key encoding") from exc

    if len(public_bytes) != 32:
        raise ValueError("Ed25519 public keys must be 32 bytes")

    return Ed25519PublicKey.from_public_bytes(public_bytes)


def verify_ed25519_jwt(token: str, public_key: Ed25519PublicKey) -> JwtSegments:
    """Verify ``token`` with ``public_key`` and return decoded segments."""

    parts = token.split(".")
    if len(parts) != 3:
        raise JwtVerificationError("Invalid token format")

    header_segment, payload_segment, signature_segment = parts
    header = _decode_segment(header_segment)
    if header.get("alg") not in (None, "EdDSA"):
        raise JwtVerificationError("Unsupported JWT algorithm")

    payload = _decode_segment(payload_segment)

    try:
        signature = urlsafe_b64decode(_add_base64_padding(signature_segment))
    except (ValueError, TypeError) as exc:  # pragma: no cover - defensive guard
        raise JwtVerificationError("Invalid JWT signature encoding") from exc

    message = f"{header_segment}.{payload_segment}".encode("utf-8")

    try:
        public_key.verify(signature, message)
    except InvalidSignature as exc:
        raise JwtVerificationError("Invalid token signature") from exc

    return JwtSegments(header=header, payload=payload)


__all__ = [
    "JwtSegments",
    "JwtVerificationError",
    "decode_jwt_segments",
    "load_ed25519_public_key",
    "verify_ed25519_jwt",
]
