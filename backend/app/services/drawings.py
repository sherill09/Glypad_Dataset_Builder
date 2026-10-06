"""
The hash + dedup logic for uploading a drawing backed by MongoDB via Motor.
"""

import uuid
from datetime import datetime, timezone
from typing import Any

from motor.motor_asyncio import AsyncIOMotorDatabase

from app.schemas.drawing import AnnotationVersionSummary, DrawingOut
from app.services.classification import classify
from app.services.hashing import sha256_hex
from app.services.storage import get_storage


def _store_bytes(data: bytes, filename: str) -> tuple[str | None, bool, str | None]:
    """Returns (storage_key, stored, storage_note)."""
    storage_key = f"{uuid.uuid4()}/{filename}"
    try:
        get_storage().save(storage_key, data)
        return storage_key, True, None
    except Exception as exc:
        return None, False, f"Upload failed: {exc}"


def version_to_summary(v: dict[str, Any]) -> AnnotationVersionSummary:
    return AnnotationVersionSummary(
        id=uuid.UUID(v["_id"]),
        version_number=v["version_number"],
        status=v["status"],
        is_current=v["is_current"],
        created_by_email=v.get("created_by_email"),
        created_at=v["created_at"],
        approved_at=v.get("approved_at"),
        superseded_by_id=uuid.UUID(v["superseded_by_id"]) if v.get("superseded_by_id") else None,
    )


def drawing_to_out(drawing: dict[str, Any], versions: list[dict[str, Any]]) -> DrawingOut:
    return DrawingOut(
        id=uuid.UUID(drawing["_id"]),
        content_hash=drawing["content_hash"],
        original_filename=drawing["original_filename"],
        source_link=drawing.get("source_link"),
        category=drawing["category"],
        format=drawing["format"],
        complexity=drawing["complexity"],
        page_count=drawing.get("page_count", 1),
        has_vector_geo=drawing.get("has_vector_geo", False),
        has_raster_geo=drawing.get("has_raster_geo", False),
        has_vector_text=drawing.get("has_vector_text", False),
        has_raster_text=drawing.get("has_raster_text", False),
        stored=drawing.get("stored", False),
        storage_note=drawing.get("storage_note"),
        first_uploaded_by_email=drawing.get("first_uploaded_by_email"),
        created_at=drawing["created_at"],
        version_count=drawing.get("version_count", len(versions)),
        annotation_versions=[version_to_summary(v) for v in versions],
    )


async def find_or_create_drawing(
    db: AsyncIOMotorDatabase, data: bytes, filename: str, current_user: dict[str, Any]
) -> tuple[dict[str, Any], bool]:
    """Returns (drawing_doc, created). Raises ValueError for unsupported."""
    content_hash = sha256_hex(data)

    existing = await db["drawings"].find_one({"content_hash": content_hash})
    if existing is not None:
        if not existing.get("stored", False):
            storage_key, stored, storage_note = _store_bytes(data, filename)
            now = datetime.now(timezone.utc)
            update = {
                "storage_key": storage_key,
                "stored": stored,
                "storage_note": storage_note,
                "size_bytes": len(data),
                "file_cached_at": now if stored else None,
            }
            await db["drawings"].update_one({"_id": existing["_id"]}, {"$set": update})
            existing.update(update)
        return existing, False

    result = classify(filename, data)
    if not result.supported:
        raise ValueError("unsupported")

    storage_key, stored, storage_note = _store_bytes(data, filename)
    drawing_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)

    drawing_doc = {
        "_id": drawing_id,
        "content_hash": content_hash,
        "original_filename": filename,
        "source_link": None,
        "category": result.category,
        "format": result.format,
        "complexity": result.complexity,
        "page_count": result.page_count,
        "has_vector_geo": result.has_vector_geo,
        "has_raster_geo": result.has_raster_geo,
        "has_vector_text": result.has_vector_text,
        "has_raster_text": result.has_raster_text,
        "storage_key": storage_key,
        "content_type": result.content_type,
        "size_bytes": len(data),
        "stored": stored,
        "storage_note": storage_note,
        "file_cached_at": now if stored else None,
        "first_uploaded_by_id": str(current_user["id"]),
        "first_uploaded_by_email": current_user.get("email"),
        "created_at": now,
        "version_count": 1,
    }
    await db["drawings"].insert_one(drawing_doc)

    # Initial draft annotation version (v1)
    version_id = str(uuid.uuid4())
    version_doc = {
        "_id": version_id,
        "drawing_id": drawing_id,
        "version_number": 1,
        "status": "draft",
        "is_current": True,
        "standard": None,
        "units": None,
        "discipline": None,
        "scale": None,
        "general_tolerance_grade": None,
        "created_by_id": str(current_user["id"]),
        "created_by_email": current_user.get("email"),
        "created_at": now,
        "approved_by_id": None,
        "approved_by_email": None,
        "approved_at": None,
        "superseded_by_id": None,
        "regions": [],
        "entities": [],
    }
    await db["annotation_versions"].insert_one(version_doc)

    return drawing_doc, True


async def resume_drawing_file(
    db: AsyncIOMotorDatabase, drawing: dict[str, Any], data: bytes, filename: str
) -> None:
    if sha256_hex(data) != drawing["content_hash"]:
        raise ValueError("mismatch")

    storage_key, stored, storage_note = _store_bytes(data, filename)
    now = datetime.now(timezone.utc)
    update = {
        "storage_key": storage_key,
        "stored": stored,
        "storage_note": storage_note,
        "size_bytes": len(data),
        "file_cached_at": now if stored else None,
    }
    await db["drawings"].update_one({"_id": drawing["_id"]}, {"$set": update})
    drawing.update(update)
