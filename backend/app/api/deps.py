"""
Shared FastAPI dependencies for MongoDB with Motor.
"""

import uuid
from typing import Any

from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.core.database import get_db
from app.core.security import decode_access_token

__all__ = [
    "get_db",
    "get_annotation_version_or_404",
    "get_editable_annotation_version_or_404",
    "get_current_user",
]

_bearer_scheme = HTTPBearer(auto_error=False)


async def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer_scheme),
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> dict[str, Any]:
    unauthorized = HTTPException(status_code=401, detail="Not authenticated")
    if credentials is None:
        raise unauthorized
    user_id = decode_access_token(credentials.credentials)
    if user_id is None:
        raise unauthorized

    user = await db["users"].find_one({"_id": str(user_id)})
    if user is None or not user.get("is_active", True):
        raise unauthorized

    # Ensure "id" field matches Pydantic UUID expectations
    user["id"] = uuid.UUID(user["_id"])
    return user


async def get_annotation_version_or_404(
    annotation_version_id: uuid.UUID,
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> dict[str, Any]:
    version = await db["annotation_versions"].find_one({"_id": str(annotation_version_id)})
    if version is None:
        raise HTTPException(status_code=404, detail="Annotation version not found")

    version["id"] = uuid.UUID(version["_id"])
    version["drawing_id"] = uuid.UUID(version["drawing_id"])
    if version.get("superseded_by_id"):
        version["superseded_by_id"] = uuid.UUID(version["superseded_by_id"])
    return version


def get_editable_annotation_version_or_404(
    version: dict[str, Any] = Depends(get_annotation_version_or_404),
) -> dict[str, Any]:
    """Every route that changes a version's content depends on this.
    An approved version is read-only — start a new version to make changes."""
    if version.get("status") == "approved":
        raise HTTPException(
            status_code=400,
            detail="This version is approved and read-only — start a new version to make changes",
        )
    return version
