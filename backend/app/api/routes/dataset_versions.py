"""
Dataset versions route backed by MongoDB via Motor.
"""

import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.api.deps import get_current_user, get_db
from app.schemas.dataset_version import (
    DatasetVersionCreate,
    DatasetVersionExportOut,
    DatasetVersionOut,
    ExportPreviewOut,
)
from app.services.export import build_export

router = APIRouter(prefix="/dataset-versions", tags=["dataset-versions"], dependencies=[Depends(get_current_user)])


def _dv_to_out(d: dict[str, Any]) -> DatasetVersionOut:
    return DatasetVersionOut(
        id=uuid.UUID(str(d["_id"])),
        version_number=d["version_number"],
        created_by_email=d.get("created_by_email"),
        created_at=d["created_at"],
        drawing_count=d["drawing_count"],
        annotation_count=d["annotation_count"],
        notes=d.get("notes"),
    )


@router.get("", response_model=list[DatasetVersionOut])
async def list_dataset_versions(db: AsyncIOMotorDatabase = Depends(get_db)) -> list[DatasetVersionOut]:
    cursor = db["dataset_versions"].find().sort("version_number", -1)
    docs = await cursor.to_list(length=1000)
    return [_dv_to_out(d) for d in docs]


@router.get("/preview", response_model=ExportPreviewOut)
async def preview_export(db: AsyncIOMotorDatabase = Depends(get_db)) -> ExportPreviewOut:
    result = await build_export(db)
    return ExportPreviewOut(drawing_count=result.drawing_count, annotation_count=result.annotation_count)


@router.post("", response_model=DatasetVersionExportOut, status_code=201)
async def create_dataset_version(
    payload: DatasetVersionCreate,
    db: AsyncIOMotorDatabase = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> DatasetVersionExportOut:
    result = await build_export(db)
    if result.drawing_count == 0:
        raise HTTPException(status_code=400, detail="No drawing has a current, approved version yet — nothing to export")

    latest = await db["dataset_versions"].find_one(sort=[("version_number", -1)])
    next_version_number = (latest["version_number"] if latest else 0) + 1

    dv_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)
    dv_doc = {
        "_id": dv_id,
        "version_number": next_version_number,
        "created_by_id": str(current_user["id"]),
        "created_by_email": current_user.get("email"),
        "created_at": now,
        "drawing_count": result.drawing_count,
        "annotation_count": result.annotation_count,
        "notes": payload.notes,
    }
    await db["dataset_versions"].insert_one(dv_doc)

    return DatasetVersionExportOut(dataset_version=_dv_to_out(dv_doc), export=result.as_dict())
