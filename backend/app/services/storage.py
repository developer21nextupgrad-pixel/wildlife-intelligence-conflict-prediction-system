from abc import ABC, abstractmethod
from functools import lru_cache
from pathlib import Path
import logging
import re

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
    ) -> None:
        if not bucket:
            raise ValueError("S3_BUCKET must be configured when STORAGE_BACKEND=s3.")
        self.bucket = bucket
        client_kwargs: dict = {
            "region_name": region,
            "use_ssl": use_ssl,
            "config": BotoConfig(signature_version="s3v4", retries={"max_attempts": 3}),
        }
        if endpoint_url:
            client_kwargs["endpoint_url"] = endpoint_url
        if access_key_id and secret_access_key:
            client_kwargs["aws_access_key_id"] = access_key_id
            client_kwargs["aws_secret_access_key"] = secret_access_key
        self._client = boto3.client("s3", **client_kwargs)

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
            logger.error("S3 put_object failed for key=%s: %s", safe_key, type(exc).__name__)
            raise ObjectStorageError("Failed to persist object to S3-compatible storage.") from exc

    def get_bytes(self, key: str) -> bytes:
        safe_key = validate_object_key(key)
        try:
            resp = self._client.get_object(Bucket=self.bucket, Key=safe_key)
            return resp["Body"].read()
        except ClientError as exc:
            code = exc.response.get("Error", {}).get("Code", "")
            if code in {"NoSuchKey", "404"}:
                raise FileNotFoundError(f"Stored object not found: {safe_key}") from exc
            logger.error("S3 get_object failed for key=%s: %s", safe_key, code)
            raise ObjectStorageError("Failed to read object from S3-compatible storage.") from exc
        except BotoCoreError as exc:
            logger.error("S3 get_object failed for key=%s: %s", safe_key, type(exc).__name__)
            raise ObjectStorageError("Failed to read object from S3-compatible storage.") from exc

    def exists(self, key: str) -> bool:
        safe_key = validate_object_key(key)
        try:
            self._client.head_object(Bucket=self.bucket, Key=safe_key)
            return True
        except ClientError:
            return False

    def delete(self, key: str) -> None:
        safe_key = validate_object_key(key)
        try:
            self._client.delete_object(Bucket=self.bucket, Key=safe_key)
        except (BotoCoreError, ClientError) as exc:
            logger.error("S3 delete_object failed for key=%s: %s", safe_key, type(exc).__name__)
            raise ObjectStorageError("Failed to delete object from S3-compatible storage.") from exc


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
