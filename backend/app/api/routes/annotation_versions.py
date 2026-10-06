"""
Annotation version routes backed by MongoDB via Motor.
"""

import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.services.entity_taxonomy import resolve_stored
from app.api.deps import (
    get_annotation_version_or_404,
    get_current_user,
    get_db,
    get_editable_annotation_version_or_404,
)
from app.schemas.annotation_version import (
    AnnotationVersionDeleteResult,
    AnnotationVersionOut,
    AnnotationVersionUpdate,
)
from app.services.helpers import annotation_version_to_out
from app.services.storage import get_storage

router = APIRouter(
    prefix="/annotation-versions",
    tags=["annotation-versions"],
    dependencies=[Depends(get_current_user)],
)


@router.get("/{annotation_version_id}", response_model=AnnotationVersionOut)
async def get_annotation_version(
    version: dict[str, Any] = Depends(get_annotation_version_or_404),
) -> AnnotationVersionOut:
    return annotation_version_to_out(version)


@router.patch("/{annotation_version_id}", response_model=AnnotationVersionOut)
async def update_annotation_version(
    patch: AnnotationVersionUpdate,
    version: dict[str, Any] = Depends(get_editable_annotation_version_or_404),
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> AnnotationVersionOut:
    update_fields = patch.model_dump(exclude_unset=True)
    if update_fields:
        await db["annotation_versions"].update_one(
            {"_id": str(version["_id"])},
            {"$set": update_fields},
        )
        version.update(update_fields)
    return annotation_version_to_out(version)


@router.post("/{annotation_version_id}/approve", response_model=AnnotationVersionOut)
async def approve_annotation_version(
    version: dict[str, Any] = Depends(get_annotation_version_or_404),
    db: AsyncIOMotorDatabase = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> AnnotationVersionOut:
    if version.get("status") == "approved":
        raise HTTPException(status_code=400, detail="This version is already approved")
    regions = version.get("regions", [])
    if not regions:
        raise HTTPException(status_code=400, detail="Add at least one region before approving")

    unfinished = [r for r in regions if r.get("status") != "done"]
    if unfinished:
        raise HTTPException(
            status_code=400,
            detail=f"{len(unfinished)} of {len(regions)} region(s) aren't marked done yet",
        )
    suggested = [e for e in version.get("entities", []) if e.get("status") == "suggested"]
    if suggested:
        raise HTTPException(
            status_code=400,
            detail=f"{len(suggested)} suggested entit{'y' if len(suggested) == 1 else 'ies'} still need to be named or deleted",
        )
    entities_unfinished = [r for r in regions if r.get("entities_status") != "done"]
    if entities_unfinished:
        raise HTTPException(
            status_code=400,
            detail=f"{len(entities_unfinished)} of {len(regions)} region(s) haven't finished entity annotation yet",
        )

    now = datetime.now(timezone.utc)
    approval_update = {
        "status": "approved",
        "approved_by_id": str(current_user["id"]),
        "approved_by_email": current_user.get("email"),
        "approved_at": now,
    }

    # Stamp superseded_by_id on previous version if applicable
    prev_version_num = version["version_number"] - 1
    await db["annotation_versions"].update_one(
        {
            "drawing_id": str(version["drawing_id"]),
            "version_number": prev_version_num,
            "superseded_by_id": None,
        },
        {"$set": {"superseded_by_id": str(version["_id"])}},
    )

    await db["annotation_versions"].update_one(
        {"_id": str(version["_id"])},
        {"$set": approval_update},
    )
    version.update(approval_update)
    return annotation_version_to_out(version)


@router.post("/{annotation_version_id}/start-new-version", response_model=AnnotationVersionOut, status_code=201)
async def start_new_version(
    version: dict[str, Any] = Depends(get_annotation_version_or_404),
    db: AsyncIOMotorDatabase = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> AnnotationVersionOut:
    if not version.get("is_current"):
        raise HTTPException(status_code=400, detail="Only the current version can be forked")
    if version.get("status") != "approved":
        raise HTTPException(status_code=400, detail="Only an approved version can be forked — this one is still a draft")

    # Unset is_current on existing current version
    await db["annotation_versions"].update_one(
        {"_id": str(version["_id"])},
        {"$set": {"is_current": False}},
    )

    new_version_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)

    # Copy regions forward with new IDs
    region_id_map: dict[str, str] = {}
    new_regions = []
    for old_region in version.get("regions", []):
        new_reg_id = str(uuid.uuid4())
        region_id_map[str(old_region["id"])] = new_reg_id
        new_regions.append({
            "id": new_reg_id,
            "type": old_region.get("type", "view"),
            "caption": old_region.get("caption"),
            "notes": old_region.get("notes"),
            "source": old_region.get("source", "human"),
            "status": old_region.get("status", "not_started"),
            "entities_status": old_region.get("entities_status", "not_started"),
            "points": [list(p) for p in old_region["points"]],
            "created_at": now,
            "updated_at": now,
        })

    # Copy entities forward with new IDs and remapped region IDs
    new_entities = []
    for old_entity in version.get("entities", []):
        new_ent_id = str(uuid.uuid4())
        old_reg_id = str(old_entity["region_id"]) if old_entity.get("region_id") else None
        new_reg_id = region_id_map.get(old_reg_id) if old_reg_id else None
        kind, subtype = resolve_stored(old_entity)
        new_entities.append({
            **old_entity,
            "id": new_ent_id,
            "region_id": new_reg_id,
            "kind": kind,
            "subtype": subtype,
            "bbox": [list(p) for p in old_entity["bbox"]],
            "payload": dict(old_entity.get("payload", {})),
            "created_by_id": str(current_user["id"]),
            "created_by_email": current_user.get("email"),
            "created_at": now,
            "updated_at": now,
        })

    new_version_doc = {
        "_id": new_version_id,
        "drawing_id": str(version["drawing_id"]),
        "version_number": version["version_number"] + 1,
        "status": "draft",
        "is_current": True,
        "standard": version.get("standard"),
        "units": version.get("units"),
        "discipline": version.get("discipline"),
        "scale": version.get("scale"),
        "general_tolerance_grade": version.get("general_tolerance_grade"),
        "created_by_id": str(current_user["id"]),
        "created_by_email": current_user.get("email"),
        "created_at": now,
        "approved_by_id": None,
        "approved_by_email": None,
        "approved_at": None,
        "superseded_by_id": None,
        "regions": new_regions,
        "entities": new_entities,
    }
    await db["annotation_versions"].insert_one(new_version_doc)
    await db["drawings"].update_one(
        {"_id": str(version["drawing_id"])},
        {"$inc": {"version_count": 1}},
    )

    return annotation_version_to_out(new_version_doc)


@router.delete("/{annotation_version_id}", response_model=AnnotationVersionDeleteResult)
async def delete_annotation_version(
    version: dict[str, Any] = Depends(get_annotation_version_or_404),
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> dict[str, Any]:
    drawing_id = str(version["drawing_id"])
    cursor = db["annotation_versions"].find({
        "drawing_id": drawing_id,
        "_id": {"$ne": str(version["_id"])},
    })
    siblings = await cursor.to_list(length=100)

    if not siblings:
        drawing = await db["drawings"].find_one({"_id": drawing_id})
        if drawing and drawing.get("storage_key"):
            try:
                get_storage().delete(drawing["storage_key"])
            except Exception:
                pass
        await db["drawings"].delete_one({"_id": drawing_id})
        await db["annotation_versions"].delete_one({"_id": str(version["_id"])})
        return {
            "drawing_deleted": True,
            "drawing_id": uuid.UUID(drawing_id),
            "new_current_version_id": None,
        }

    # Clear superseded pointers to this version
    await db["annotation_versions"].update_many(
        {"drawing_id": drawing_id, "superseded_by_id": str(version["_id"])},
        {"$set": {"superseded_by_id": None}},
    )

    await db["annotation_versions"].delete_one({"_id": str(version["_id"])})
    await db["drawings"].update_one(
        {"_id": drawing_id},
        {"$inc": {"version_count": -1}},
    )

    new_current = max(siblings, key=lambda v: v["version_number"])
    await db["annotation_versions"].update_one(
        {"_id": str(new_current["_id"])},
        {"$set": {"is_current": True}},
    )

    return {
        "drawing_deleted": False,
        "drawing_id": uuid.UUID(drawing_id),
        "new_current_version_id": uuid.UUID(str(new_current["_id"])),
    }
