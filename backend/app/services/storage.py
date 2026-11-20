from abc import ABC, abstractmethod
from functools import lru_cache
import ipaddress
import logging
from pathlib import Path
import re
from typing import Any
from urllib.parse import urlparse, urlunparse

import boto3
from botocore.config import Config as BotoConfig
from botocore.exceptions import BotoCoreError, ClientError

from app.core.config import Settings, get_settings

logger = logging.getLogger("wicps.storage")

_SAFE_KEY_RE = re.compile(r"^[a-zA-Z0-9._/-]+$")


def validate_object_key(key: str) -> str:
    cleaned = key.strip().lstrip("/")
    if not cleaned or ".." in cleaned.split("/") or not _SAFE_KEY_RE.match(cleaned):
        raise ValueError(f"Invalid object storage key: {key!r}")
    return cleaned


def _clean_str(value: str | None) -> str | None:
    if value is None:
        return None
    cleaned = value.strip()
    if len(cleaned) >= 2 and cleaned[0] == cleaned[-1] and cleaned[0] in {"'", '"'}:
        cleaned = cleaned[1:-1].strip()
    return cleaned or None


def _is_tigris_hostname(hostname: str | None) -> bool:
    if not hostname:
        return False
    host = hostname.lower()
    return (
        host == "t3.storage.dev"
        or host == "fly.storage.tigris.dev"
        or host.endswith(".storage.dev")
        or host.endswith(".tigris.dev")
    )


def _is_ip_or_localhost(hostname: str | None) -> bool:
    if not hostname:
        return False
    host = hostname.strip("[]").lower()
    if host in {"localhost", "127.0.0.1", "::1"}:
        return True
    try:
        ipaddress.ip_address(host)
        return True
    except ValueError:
        return False


def _normalize_endpoint_url(
    endpoint_url: str | None, use_ssl: bool, bucket: str
) -> tuple[str | None, bool]:
    cleaned = _clean_str(endpoint_url)
    if not cleaned:
        return None, use_ssl

    if "://" not in cleaned:
        scheme = "https" if use_ssl else "http"
        cleaned = f"{scheme}://{cleaned}"

    parsed = urlparse(cleaned)
    effective_use_ssl = use_ssl
    if parsed.scheme == "http":
        effective_use_ssl = False
    elif parsed.scheme == "https":
        effective_use_ssl = True

    hostname = parsed.hostname or ""
    netloc = parsed.netloc
    bucket_prefix = f"{bucket.lower()}."
    if hostname.lower().startswith(bucket_prefix) and _is_tigris_hostname(hostname):
        stripped_host = hostname[len(bucket_prefix) :]
        port_part = f":{parsed.port}" if parsed.port else ""
        netloc = f"{stripped_host}{port_part}"
        logger.warning(
            "Normalized S3_ENDPOINT_URL by stripping redundant bucket subdomain prefix; configure S3_ENDPOINT_URL without '<bucket>.'."
        )

    normalized_path = parsed.path.rstrip("/")
    normalized = urlunparse((parsed.scheme, netloc, normalized_path, "", "", ""))
    return normalized.rstrip("/"), effective_use_ssl


def _resolve_addressing_style(
    endpoint_url: str | None, explicit_style: str | None = None
) -> str:
    style = (_clean_str(explicit_style) or "").lower()
    if style in {"virtual", "path", "auto"}:
        return style
    if not endpoint_url:
        return "auto"

    hostname = urlparse(endpoint_url).hostname
    if _is_ip_or_localhost(hostname):
        return "path"
    if _is_tigris_hostname(hostname):
        return "virtual"
    return "auto"


def _sanitize_error_text(text: str, *secrets: str | None) -> str:
    sanitized = text
    for secret in secrets:
        if secret and len(secret) >= 4:
            sanitized = sanitized.replace(secret, "[REDACTED]")
    return sanitized


def _extract_s3_error(
    exc: Exception, *secrets: str | None
) -> tuple[str, int | None, str, str | None]:
    if isinstance(exc, ClientError):
        response = getattr(exc, "response", None) or {}
        err = response.get("Error", {}) or {}
        meta = response.get("ResponseMetadata", {}) or {}
        http_status = meta.get("HTTPStatusCode")
        code = str(err.get("Code") or http_status or "ClientError")
        raw_msg = str(err.get("Message") or exc)
        request_id = meta.get("RequestId")
        return code, http_status, _sanitize_error_text(raw_msg, *secrets), request_id

    code = type(exc).__name__
    raw_msg = str(exc) or code
    return code, None, _sanitize_error_text(raw_msg, *secrets), None


class ObjectStorageError(RuntimeError):
    """Raised when reading or writing to object storage fails."""


class ObjectStorageBackend(ABC):
    backend_name: str

    @abstractmethod
    def put_bytes(self, key: str, data: bytes, content_type: str = "application/octet-stream") -> str:
        raise NotImplementedError

    @abstractmethod
    def get_bytes(self, key: str) -> bytes:
        raise NotImplementedError

    @abstractmethod
    def exists(self, key: str) -> bool:
        raise NotImplementedError

    @abstractmethod
    def delete(self, key: str) -> None:
        raise NotImplementedError

    def verify_access(self) -> dict[str, Any]:
        return {"backend": self.backend_name, "reachable": True}


class FilesystemObjectStorage(ObjectStorageBackend):
    backend_name = "filesystem"

    def __init__(self, root_dir: str | Path) -> None:
        self.root_dir = Path(root_dir).resolve()
        self.root_dir.mkdir(parents=True, exist_ok=True)

    def _resolve_path(self, key: str) -> Path:
        safe_key = validate_object_key(key)
        target = (self.root_dir / safe_key).resolve()
        if self.root_dir != target and self.root_dir not in target.parents:
            raise ValueError("Object key escapes storage root directory.")
        return target

    def put_bytes(self, key: str, data: bytes, content_type: str = "application/octet-stream") -> str:
        safe_key = validate_object_key(key)
        target = self._resolve_path(safe_key)
        target.parent.mkdir(parents=True, exist_ok=True)
        tmp_path = target.with_suffix(target.suffix + ".tmp")
        tmp_path.write_bytes(data)
        tmp_path.replace(target)
        return safe_key

    def get_bytes(self, key: str) -> bytes:
        target = self._resolve_path(key)
        if not target.is_file():
            raise FileNotFoundError(f"Stored object not found: {key}")
        return target.read_bytes()

    def exists(self, key: str) -> bool:
        try:
            return self._resolve_path(key).is_file()
        except ValueError:
            return False

    def delete(self, key: str) -> None:
        target = self._resolve_path(key)
        if target.is_file():
            target.unlink()

    def verify_access(self) -> dict[str, Any]:
        return {
            "backend": self.backend_name,
            "reachable": self.root_dir.is_dir(),
            "root_dir": str(self.root_dir),
        }


class S3ObjectStorage(ObjectStorageBackend):
    backend_name = "s3"

    def __init__(
        self,
        bucket: str,
        region: str = "us-east-1",
        endpoint_url: str | None = None,
        access_key_id: str | None = None,
        secret_access_key: str | None = None,
        use_ssl: bool = True,
        addressing_style: str | None = None,
    ) -> None:
        clean_bucket = _clean_str(bucket)
        if not clean_bucket:
            raise ValueError("S3_BUCKET must be configured when STORAGE_BACKEND=s3.")

        clean_access_key = _clean_str(access_key_id)
        clean_secret_key = _clean_str(secret_access_key)
        if bool(clean_access_key) != bool(clean_secret_key):
            raise ObjectStorageError(
                "S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY must both be configured together."
            )

        normalized_endpoint, effective_use_ssl = _normalize_endpoint_url(
            endpoint_url, use_ssl, clean_bucket
        )
        clean_region = _clean_str(region)
        if not clean_region:
            clean_region = (
                "auto"
                if normalized_endpoint and _is_tigris_hostname(urlparse(normalized_endpoint).hostname)
                else "us-east-1"
            )

        resolved_style = _resolve_addressing_style(normalized_endpoint, addressing_style)

        self.bucket = clean_bucket
        self.region = clean_region
        self.endpoint_url = normalized_endpoint
        self.use_ssl = effective_use_ssl
        self.addressing_style = resolved_style
        self._secret_values = tuple(s for s in (clean_access_key, clean_secret_key) if s)

        boto_config = BotoConfig(
            signature_version="s3v4",
            retries={"max_attempts": 3, "mode": "standard"},
            s3={"addressing_style": resolved_style},
            request_checksum_calculation="when_required",
            response_checksum_validation="when_required",
        )
        client_kwargs: dict[str, Any] = {
            "region_name": clean_region,
            "use_ssl": effective_use_ssl,
            "config": boto_config,
        }
        if normalized_endpoint:
            client_kwargs["endpoint_url"] = normalized_endpoint
        if clean_access_key and clean_secret_key:
            client_kwargs["aws_access_key_id"] = clean_access_key
            client_kwargs["aws_secret_access_key"] = clean_secret_key
        self._client = boto3.client("s3", **client_kwargs)

    def _log_s3_failure(self, operation: str, key: str | None, exc: Exception) -> tuple[str, str]:
        code, http_status, msg, request_id = _extract_s3_error(exc, *self._secret_values)
        logger.error(
            "S3 %s failed bucket=%s endpoint=%s region=%s addressing_style=%s key=%s code=%s http_status=%s request_id=%s message=%s",
            operation,
            self.bucket,
            self.endpoint_url or "aws-default",
            self.region,
            self.addressing_style,
            key or "-",
            code,
            http_status,
            request_id or "-",
            msg,
        )
        return code, msg

    def put_bytes(self, key: str, data: bytes, content_type: str = "application/octet-stream") -> str:
        safe_key = validate_object_key(key)
        try:
            self._client.put_object(
                Bucket=self.bucket,
                Key=safe_key,
                Body=data,
                ContentType=content_type,
            )
            return safe_key
        except (BotoCoreError, ClientError) as exc:
            code, msg = self._log_s3_failure("put_object", safe_key, exc)
            raise ObjectStorageError(
                f"Failed to persist object to S3-compatible storage ({code}): {msg}"
            ) from exc

    def get_bytes(self, key: str) -> bytes:
        safe_key = validate_object_key(key)
        try:
            resp = self._client.get_object(Bucket=self.bucket, Key=safe_key)
            return resp["Body"].read()
        except ClientError as exc:
            code, _, _, _ = _extract_s3_error(exc, *self._secret_values)
            if code in {"NoSuchKey", "404"}:
                raise FileNotFoundError(f"Stored object not found: {safe_key}") from exc
            code, msg = self._log_s3_failure("get_object", safe_key, exc)
            raise ObjectStorageError(
                f"Failed to read object from S3-compatible storage ({code}): {msg}"
            ) from exc
        except BotoCoreError as exc:
            code, msg = self._log_s3_failure("get_object", safe_key, exc)
            raise ObjectStorageError(
                f"Failed to read object from S3-compatible storage ({code}): {msg}"
            ) from exc

    def exists(self, key: str) -> bool:
        safe_key = validate_object_key(key)
        try:
            self._client.head_object(Bucket=self.bucket, Key=safe_key)
            return True
        except ClientError as exc:
            code, http_status, _, _ = _extract_s3_error(exc, *self._secret_values)
            if code in {"NoSuchKey", "NotFound", "404"} or http_status == 404:
                return False
            self._log_s3_failure("head_object", safe_key, exc)
            return False
        except BotoCoreError as exc:
            self._log_s3_failure("head_object", safe_key, exc)
            return False

    def delete(self, key: str) -> None:
        safe_key = validate_object_key(key)
        try:
            self._client.delete_object(Bucket=self.bucket, Key=safe_key)
        except (BotoCoreError, ClientError) as exc:
            code, msg = self._log_s3_failure("delete_object", safe_key, exc)
            raise ObjectStorageError(
                f"Failed to delete object from S3-compatible storage ({code}): {msg}"
            ) from exc

    def verify_access(self) -> dict[str, Any]:
        info: dict[str, Any] = {
            "backend": self.backend_name,
            "bucket": self.bucket,
            "endpoint_url": self.endpoint_url or "aws-default",
            "region": self.region,
            "addressing_style": self.addressing_style,
            "use_ssl": self.use_ssl,
        }
        try:
            self._client.head_bucket(Bucket=self.bucket)
            info["reachable"] = True
            return info
        except (BotoCoreError, ClientError) as exc:
            code, msg = self._log_s3_failure("head_bucket", None, exc)
            info["reachable"] = False
            info["error_code"] = code
            info["error_message"] = msg
            return info


def build_storage_backend(settings: Settings) -> ObjectStorageBackend:
    backend = (settings.storage_backend or "filesystem").strip().lower()
    if backend == "s3":
        if not settings.s3_bucket:
            raise ObjectStorageError("S3_BUCKET is required when storage_backend='s3'.")
        return S3ObjectStorage(
            bucket=settings.s3_bucket,
            region=settings.s3_region,
            endpoint_url=settings.s3_endpoint_url,
            access_key_id=settings.s3_access_key_id,
            secret_access_key=settings.s3_secret_access_key,
            use_ssl=settings.s3_use_ssl,
        )
    return FilesystemObjectStorage(settings.local_storage_dir)


@lru_cache(maxsize=1)
def get_storage_backend() -> ObjectStorageBackend:
    return build_storage_backend(get_settings())
