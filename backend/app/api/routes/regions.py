"""
CRUD for traced regions on an annotation version backed by MongoDB via Motor.
"""

import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.api.deps import get_current_user, get_db, get_editable_annotation_version_or_404
from app.schemas.region import RegionCreate, RegionMerge, RegionOut, RegionUpdate
from app.services.helpers import region_to_out
from app.services.regions import merged_fields

router = APIRouter(
    prefix="/annotation-versions/{annotation_version_id}/regions",
    tags=["regions"],
    dependencies=[Depends(get_current_user)],
)


def _find_region(version: dict[str, Any], region_id: uuid.UUID) -> dict[str, Any]:
    target_id = str(region_id)
    for r in version.get("regions", []):
        if str(r["id"]) == target_id:
            return r
    raise HTTPException(status_code=404, detail="Region not found")


@router.post("", response_model=RegionOut, status_code=201)
async def create_region(
    payload: RegionCreate,
    version: dict[str, Any] = Depends(get_editable_annotation_version_or_404),
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> RegionOut:
    now = datetime.now(timezone.utc)
    new_region_id = str(uuid.uuid4())
    region_data = {
        "id": new_region_id,
        "type": payload.type,
        "caption": payload.caption,
        "notes": payload.notes,
        "source": payload.source,
        "status": payload.status,
        "entities_status": payload.entities_status,
        "points": [list(p) for p in payload.points],
        "created_at": now,
        "updated_at": now,
    }

    await db["annotation_versions"].update_one(
        {"_id": str(version["_id"])},
        {"$push": {"regions": region_data}},
    )
    return region_to_out(region_data, str(version["_id"]))


@router.post("/merge", response_model=RegionOut)
async def merge_regions(
    payload: RegionMerge,
    version: dict[str, Any] = Depends(get_editable_annotation_version_or_404),
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> RegionOut:
    wanted = {str(rid) for rid in payload.region_ids}
    if len(wanted) < 2:
        raise HTTPException(status_code=400, detail="Pick at least two different regions to merge")

    existing_regions = version.get("regions", [])
    selected = [r for r in existing_regions if str(r["id"]) in wanted]
    if len(selected) != len(wanted):
        raise HTTPException(status_code=404, detail="One or more regions were not found on this annotation version")

    target, *others = selected
    merged = merged_fields(selected)
    now = datetime.now(timezone.utc)
    target.update(merged)
    target["source"] = "human"
    target["updated_at"] = now

    other_ids = {str(o["id"]) for o in others}
    remaining_regions = [r for r in existing_regions if str(r["id"]) not in other_ids]

    # Re-point entities belonging to any deleted region to target
    entities = version.get("entities", [])
    target_id_str = str(target["id"])
    for entity in entities:
        if entity.get("region_id") and str(entity["region_id"]) in other_ids:
            entity["region_id"] = target_id_str
            entity["updated_at"] = now

    await db["annotation_versions"].update_one(
        {"_id": str(version["_id"])},
        {"$set": {"regions": remaining_regions, "entities": entities}},
    )

    return region_to_out(target, str(version["_id"]))


@router.patch("/{region_id}", response_model=RegionOut)
async def update_region(
    region_id: uuid.UUID,
    patch: RegionUpdate,
    version: dict[str, Any] = Depends(get_editable_annotation_version_or_404),
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> RegionOut:
    target = _find_region(version, region_id)
    patch_data = patch.model_dump(exclude_unset=True)
    if patch_data.get("entities_status") == "done":
        pending = [
            e for e in version.get("entities", [])
            if e.get("region_id") == str(region_id) and e.get("status") == "suggested"
        ]
        if pending:
            raise HTTPException(
                status_code=400,
                detail=f"{len(pending)} suggested entit{'y' if len(pending) == 1 else 'ies'} in this region still need to be named or deleted",
            )
    if "points" in patch_data and patch_data["points"] is not None:
        patch_data["points"] = [list(p) for p in patch_data["points"]]

    now = datetime.now(timezone.utc)
    patch_data["updated_at"] = now
    target.update(patch_data)

    await db["annotation_versions"].update_one(
        {"_id": str(version["_id"]), "regions.id": str(region_id)},
        {"$set": {f"regions.$.{k}": v for k, v in patch_data.items()}},
    )
    return region_to_out(target, str(version["_id"]))


@router.delete("/{region_id}", status_code=204)
async def delete_region(
    region_id: uuid.UUID,
    version: dict[str, Any] = Depends(get_editable_annotation_version_or_404),
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> None:
    _find_region(version, region_id)
    rid_str = str(region_id)

    # Remove region and set region_id to None on entities that pointed to it
    await db["annotation_versions"].update_one(
        {"_id": str(version["_id"])},
        {
            "$pull": {"regions": {"id": rid_str}},
            "$set": {"entities.$[elem].region_id": None},
        },
        array_filters=[{"elem.region_id": rid_str}],
    )
