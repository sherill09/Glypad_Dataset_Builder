"""
Upload-with-dedup and listing for drawings backed by MongoDB via Motor.
"""

import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, UploadFile
from fastapi.responses import Response
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.api.deps import get_current_user, get_db
from app.core.config import settings
from app.schemas.drawing import DrawingOut, DrawingUpdate, DrawingUploadResult
from app.services.drawings import drawing_to_out, find_or_create_drawing, resume_drawing_file
from app.services.storage import get_storage

router = APIRouter(prefix="/drawings", tags=["drawings"], dependencies=[Depends(get_current_user)])


async def _fetch_versions_for_drawing(db: AsyncIOMotorDatabase, drawing_id: str) -> list[dict[str, Any]]:
    cursor = db["annotation_versions"].find({"drawing_id": drawing_id}).sort("version_number", 1)
    return await cursor.to_list(length=100)


@router.post("", response_model=DrawingUploadResult, status_code=201)
async def upload_drawing(
    upload: UploadFile,
    db: AsyncIOMotorDatabase = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> DrawingUploadResult:
    data = await upload.read()
    if len(data) == 0:
        raise HTTPException(status_code=400, detail="Uploaded file is empty")
    if len(data) > settings.max_upload_bytes:
        raise HTTPException(status_code=413, detail=f"File is larger than the {settings.MAX_UPLOAD_MB} MB limit")

    try:
        drawing, created = await find_or_create_drawing(db, data, upload.filename or "upload", current_user)
    except ValueError:
        raise HTTPException(status_code=415, detail=f"Unsupported file type: {upload.filename}")

    versions = await _fetch_versions_for_drawing(db, drawing["_id"])
    return DrawingUploadResult(created=created, drawing=drawing_to_out(drawing, versions))


@router.get("", response_model=list[DrawingOut])
async def list_drawings(db: AsyncIOMotorDatabase = Depends(get_db)) -> list[DrawingOut]:
    cursor = db["drawings"].find().sort("created_at", -1)
    drawings = await cursor.to_list(length=1000)

    result: list[DrawingOut] = []
    for drawing in drawings:
        versions = await _fetch_versions_for_drawing(db, drawing["_id"])
        result.append(drawing_to_out(drawing, versions))
    return result


@router.get("/{drawing_id}", response_model=DrawingOut)
async def get_drawing(
    drawing_id: uuid.UUID, db: AsyncIOMotorDatabase = Depends(get_db)
) -> DrawingOut:
    drawing = await db["drawings"].find_one({"_id": str(drawing_id)})
    if drawing is None:
        raise HTTPException(status_code=404, detail="Drawing not found")
    versions = await _fetch_versions_for_drawing(db, drawing["_id"])
    return drawing_to_out(drawing, versions)


@router.patch("/{drawing_id}", response_model=DrawingOut)
async def update_drawing(
    drawing_id: uuid.UUID,
    patch: DrawingUpdate,
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> DrawingOut:
    drawing = await db["drawings"].find_one({"_id": str(drawing_id)})
    if drawing is None:
        raise HTTPException(status_code=404, detail="Drawing not found")

    update_fields = patch.model_dump(exclude_unset=True)
    if update_fields:
        await db["drawings"].update_one({"_id": str(drawing_id)}, {"$set": update_fields})
        drawing.update(update_fields)

    versions = await _fetch_versions_for_drawing(db, drawing["_id"])
    return drawing_to_out(drawing, versions)


@router.post("/{drawing_id}/resume", response_model=DrawingOut)
async def resume_drawing(
    drawing_id: uuid.UUID,
    upload: UploadFile,
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> DrawingOut:
    drawing = await db["drawings"].find_one({"_id": str(drawing_id)})
    if drawing is None:
        raise HTTPException(status_code=404, detail="Drawing not found")

    data = await upload.read()
    if len(data) == 0:
        raise HTTPException(status_code=400, detail="Uploaded file is empty")
    if len(data) > settings.max_upload_bytes:
        raise HTTPException(status_code=413, detail=f"File is larger than the {settings.MAX_UPLOAD_MB} MB limit")

    try:
        await resume_drawing_file(db, drawing, data, upload.filename or drawing["original_filename"])
    except ValueError:
        raise HTTPException(
            status_code=400,
            detail="That file's content doesn't match this drawing — please re-upload the exact same file",
        )

    versions = await _fetch_versions_for_drawing(db, drawing["_id"])
    return drawing_to_out(drawing, versions)


@router.get("/{drawing_id}/content")
async def get_drawing_content(
    drawing_id: uuid.UUID, db: AsyncIOMotorDatabase = Depends(get_db)
):
    drawing = await db["drawings"].find_one({"_id": str(drawing_id)})
    if drawing is None:
        raise HTTPException(status_code=404, detail="Drawing not found")
    if not drawing.get("stored", False) or not drawing.get("storage_key"):
        raise HTTPException(status_code=404, detail="This drawing's bytes aren't currently cached")
    try:
        data = get_storage().read(drawing["storage_key"])
    except Exception:
        raise HTTPException(status_code=404, detail="Drawing bytes could not be read from storage")
    return Response(content=data, media_type=drawing.get("content_type") or "application/octet-stream")
