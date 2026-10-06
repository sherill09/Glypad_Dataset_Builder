"""
Storage backend abstraction.

The rest of the app only ever talks to `get_storage()`, and only ever calls
`.save()`, `.read()` and `.delete()` — it never knows or cares whether the
bytes end up on the local disk or in an S3 bucket. That's the point of this
file: swapping STORAGE_BACKEND from "local" to "s3" in your .env is the
*only* change needed to move from developing on your laptop to running in
production against real S3. No other code changes.

This is a standard pattern called "dependency inversion" — the app depends
on the abstract `StorageBackend` interface, not on a specific technology.
"""

from __future__ import annotations

import abc
from pathlib import Path

from app.core.config import settings


class StorageBackend(abc.ABC):
    @abc.abstractmethod
    def save(self, key: str, data: bytes) -> None: ...

    @abc.abstractmethod
    def read(self, key: str) -> bytes: ...

    @abc.abstractmethod
    def delete(self, key: str) -> None: ...


class LocalStorageBackend(StorageBackend):
    """Saves files to a folder on disk. Good for local development — no
    AWS account needed."""

    def __init__(self, base_dir: str):
        self.base_dir = Path(base_dir).resolve()
        self.base_dir.mkdir(parents=True, exist_ok=True)

    def _resolve(self, key: str) -> Path:
        # Guard against a key trying to escape the storage folder.
        candidate = (self.base_dir / key).resolve()
        if self.base_dir not in candidate.parents and candidate != self.base_dir:
            raise ValueError(f"Invalid storage key: {key!r}")
        return candidate

    def save(self, key: str, data: bytes) -> None:
        path = self._resolve(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)

    def read(self, key: str) -> bytes:
        return self._resolve(key).read_bytes()

    def delete(self, key: str) -> None:
        path = self._resolve(key)
        if path.exists():
            path.unlink()


class S3StorageBackend(StorageBackend):
    """Saves files to an Amazon S3 bucket. Used in production."""

    def __init__(self, bucket: str, region: str, access_key: str, secret_key: str):
        import boto3  # imported lazily so `boto3` isn't required for local-only dev

        if not bucket:
            raise ValueError("AWS_S3_BUCKET must be set when STORAGE_BACKEND=s3")

        self.bucket = bucket
        kwargs = {"region_name": region}
        # If credentials aren't given, boto3 falls back to the normal AWS
        # credential chain (environment, ~/.aws/credentials, an EC2/ECS
        # instance role, etc.) — the standard, recommended way to run this
        # in production instead of hardcoding keys.
        if access_key and secret_key:
            kwargs["aws_access_key_id"] = access_key
            kwargs["aws_secret_access_key"] = secret_key
        self.client = boto3.client("s3", **kwargs)

    def save(self, key: str, data: bytes) -> None:
        self.client.put_object(Bucket=self.bucket, Key=key, Body=data)

    def read(self, key: str) -> bytes:
        response = self.client.get_object(Bucket=self.bucket, Key=key)
        return response["Body"].read()

    def delete(self, key: str) -> None:
        self.client.delete_object(Bucket=self.bucket, Key=key)


_storage_instance: StorageBackend | None = None


def get_storage() -> StorageBackend:
    global _storage_instance
    if _storage_instance is not None:
        return _storage_instance

    if settings.STORAGE_BACKEND == "s3":
        _storage_instance = S3StorageBackend(
            bucket=settings.AWS_S3_BUCKET,
            region=settings.AWS_REGION,
            access_key=settings.AWS_ACCESS_KEY_ID,
            secret_key=settings.AWS_SECRET_ACCESS_KEY,
        )
    else:
        _storage_instance = LocalStorageBackend(settings.LOCAL_STORAGE_DIR)

    return _storage_instance
