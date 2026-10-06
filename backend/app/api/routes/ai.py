"""
AI-assisted region suggestion backed by MongoDB via Motor.
"""

import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, Form, HTTPException, UploadFile
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.api.deps import get_annotation_version_or_404, get_current_user, get_db
from app.schemas.region import RegionOut
from app.services.ai_suggest import AiSuggestUnavailable, suggest_regions
from app.services.helpers import region_to_out

router = APIRouter(
    prefix="/annotation-versions/{annotation_version_id}/suggest-regions",
    tags=["ai"],
    dependencies=[Depends(get_current_user)],
)


@router.post("", response_model=list[RegionOut], status_code=201)
async def suggest_regions_for_version(
    image: UploadFile,
    width: int = Form(...),
    height: int = Form(...),
    version: dict[str, Any] = Depends(get_annotation_version_or_404),
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> list[RegionOut]:
    if width <= 0 or height <= 0:
        raise HTTPException(status_code=400, detail="width and height must be positive")

    image_bytes = await image.read()
    if len(image_bytes) == 0:
        raise HTTPException(status_code=400, detail="The captured image was empty")

    try:
        suggestions = suggest_regions(image_bytes, width, height)
    except AiSuggestUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    now = datetime.now(timezone.utc)
    created_regions = []
    for data in suggestions:
        reg_id = str(uuid.uuid4())
        created_regions.append({
            "id": reg_id,
            "type": data.get("type", "view"),
            "caption": data.get("caption"),
            "notes": data.get("notes"),
            "source": "ai",
            "status": "not_started",
            "entities_status": "not_started",
            "points": [list(p) for p in data["points"]],
            "created_at": now,
            "updated_at": now,
        })

    if created_regions:
        await db["annotation_versions"].update_one(
            {"_id": str(version["_id"])},
            {"$push": {"regions": {"$each": created_regions}}},
        )

    return [region_to_out(r, str(version["_id"])) for r in created_regions]
