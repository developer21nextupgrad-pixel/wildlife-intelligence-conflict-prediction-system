import hashlib
import hmac
import re
import secrets
from typing import Any
from urllib.parse import urlsplit, urlunsplit

_PBKDF2_ITERATIONS = 100_000
_SENSITIVE_METADATA_KEYS = {
    "password",
    "secret",
    "token",
    "api_key",
    "apikey",
    "access_key",
    "secret_key",
    "auth",
    "credentials",
}


def generate_camera_api_key() -> str:
    return f"wicps_cam_{secrets.token_urlsafe(24)}"


def hash_camera_api_key(api_key: str) -> str:
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac(
        "sha256",
        api_key.encode("utf-8"),
        salt.encode("utf-8"),
        _PBKDF2_ITERATIONS,
    ).hex()
    return f"pbkdf2_sha256${_PBKDF2_ITERATIONS}${salt}${digest}"


def verify_camera_api_key(api_key: str, stored_hash: str) -> bool:
    if not api_key or not stored_hash:
        return False
    parts = stored_hash.split("$")
    if len(parts) != 4 or parts[0] != "pbkdf2_sha256":
        return False
    try:
        iterations = int(parts[1])
    except ValueError:
        return False
    salt = parts[2]
    expected_hex = parts[3]
    computed = hashlib.pbkdf2_hmac(
        "sha256",
        api_key.encode("utf-8"),
        salt.encode("utf-8"),
        iterations,
    ).hex()
    return hmac.compare_digest(computed, expected_hex)


def mask_url_credentials(url: str) -> str:
    raw = url.strip()
    if not raw:
        return raw
    try:
        parsed = urlsplit(raw)
    except ValueError:
        return re.sub(r"://[^/@]+@", "://***:***@", raw)

    if parsed.username is None and parsed.password is None:
        return raw

    host_part = parsed.hostname or ""
    if ":" in host_part and not host_part.startswith("["):
        host_part = f"[{host_part}]"
    port_part = f":{parsed.port}" if parsed.port else ""
    masked_netloc = f"***:***@{host_part}{port_part}"
    return urlunsplit((parsed.scheme, masked_netloc, parsed.path, parsed.query, parsed.fragment))


def mask_stream_metadata(metadata: dict[str, Any] | None) -> dict[str, Any]:
    if not metadata:
        return {}
    sanitized: dict[str, Any] = {}
    for key, value in metadata.items():
        lower_key = str(key).strip().lower()
        if any(sensitive in lower_key for sensitive in _SENSITIVE_METADATA_KEYS):
            sanitized[key] = "***"
        elif isinstance(value, str) and (
            value.strip().lower().startswith(("rtsp://", "rtsps://", "http://", "https://"))
        ):
            sanitized[key] = mask_url_credentials(value)
        elif isinstance(value, dict):
            sanitized[key] = mask_stream_metadata(value)
        else:
            sanitized[key] = value
    return sanitized
