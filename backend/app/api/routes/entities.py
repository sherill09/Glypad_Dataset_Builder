"""
CRUD for Layer 3 callouts backed by MongoDB via Motor.

Whenever the text changes, the server re-reads it (callout_parser) and
stores the parsed values and any warnings alongside it. The client never
sends those directly.
"""

import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.api.deps import (
    get_annotation_version_or_404,
    get_current_user,
    get_db,
    get_editable_annotation_version_or_404,
)
from app.schemas.entity import EntityCreate, EntityOut, EntityUpdate
from app.services.callout_parser import callout_for_extraction
from app.services.entity_taxonomy import resolve_stored, validate_kind_subtype
from app.services.helpers import entity_to_out

router = APIRouter(
    prefix="/annotation-versions/{annotation_version_id}/entities",
    tags=["entities"],
    dependencies=[Depends(get_current_user)],
)


def _find_entity(version: dict[str, Any], entity_id: uuid.UUID) -> dict[str, Any]:
    target_id = str(entity_id)
    for e in version.get("entities", []):
        if str(e["id"]) == target_id:
            return e
    raise HTTPException(status_code=404, detail="Entity not found")


def _check_region_belongs(region_id: uuid.UUID | None, version: dict[str, Any]) -> None:
    if region_id is None:
        return
    reg_ids = {str(r["id"]) for r in version.get("regions", [])}
    if str(region_id) not in reg_ids:
        raise HTTPException(status_code=400, detail="region_id must be a region on this annotation version")


def _reading(text: str | None) -> dict[str, Any]:
    """Parsed values and warnings for a piece of text, ready to store."""
    if not text or not text.strip():
        return {"parsed": {}, "warnings": []}
    reading = callout_for_extraction(text, is_frame=False)
    return {"parsed": reading.parsed, "warnings": reading.warnings}


def _check_kind(kind: str, subtype: str | None) -> None:
    try:
        validate_kind_subtype(kind, subtype)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("", response_model=EntityOut, status_code=201)
async def create_entity(
    payload: EntityCreate,
    version: dict[str, Any] = Depends(get_editable_annotation_version_or_404),
    db: AsyncIOMotorDatabase = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> EntityOut:
    _check_region_belongs(payload.region_id, version)
    _check_kind(payload.kind, payload.subtype)

    new_entity_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)
    entity_data = {
        "id": new_entity_id,
        "region_id": str(payload.region_id) if payload.region_id else None,
        "kind": payload.kind,
        "subtype": payload.subtype,
        "bbox": [list(p) for p in payload.bbox],
        "text": payload.text,
        "raw_text": None,
        **_reading(payload.text),
        "payload": dict(payload.payload),
        "status": payload.status,
        "source": payload.source,
        "created_by_id": str(current_user["id"]),
        "created_by_email": current_user.get("email"),
        "created_at": now,
        "updated_at": now,
    }

    await db["annotation_versions"].update_one(
        {"_id": str(version["_id"])},
        {"$push": {"entities": entity_data}},
    )
    return entity_to_out(entity_data, str(version["_id"]))


@router.get("", response_model=list[EntityOut])
async def list_entities(
    version: dict[str, Any] = Depends(get_annotation_version_or_404),
) -> list[EntityOut]:
    v_id = str(version["_id"])
    return [entity_to_out(e, v_id) for e in version.get("entities", [])]


@router.patch("/{entity_id}", response_model=EntityOut)
async def update_entity(
    entity_id: uuid.UUID,
    patch: EntityUpdate,
    version: dict[str, Any] = Depends(get_editable_annotation_version_or_404),
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> EntityOut:
    entity = _find_entity(version, entity_id)
    data = patch.model_dump(exclude_unset=True)
    if "region_id" in data:
        _check_region_belongs(data["region_id"], version)
        if data["region_id"] is not None:
            data["region_id"] = str(data["region_id"])
    if "bbox" in data and data["bbox"] is not None:
        data["bbox"] = [list(p) for p in data["bbox"]]

    # Work out the kind/subtype that will be stored, then check the pair.
    current_kind, current_subtype = resolve_stored(entity)
    kind = data.get("kind") or current_kind
    if "subtype" in data:
        subtype = data["subtype"]
    elif "kind" in data and data["kind"] != current_kind:
        subtype = None  # a new kind starts with no subtype until one is picked
    else:
        subtype = current_subtype
    _check_kind(kind, subtype)
    data["kind"] = kind
    data["subtype"] = subtype

    if "text" in data:
        data.update(_reading(data["text"]))

    now = datetime.now(timezone.utc)
    data["updated_at"] = now
    entity.update(data)

    await db["annotation_versions"].update_one(
        {"_id": str(version["_id"]), "entities.id": str(entity_id)},
        {"$set": {f"entities.$.{k}": v for k, v in data.items()}},
    )
    return entity_to_out(entity, str(version["_id"]))


class ConfirmSuggestionsRequest(BaseModel):
    region_id: uuid.UUID
    # Leave suggestions with parser warnings for a person to look at.
    skip_warnings: bool = True


@router.post("/confirm", response_model=dict)
async def confirm_suggestions(
    body: ConfirmSuggestionsRequest,
    version: dict[str, Any] = Depends(get_editable_annotation_version_or_404),
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> dict[str, int]:
    """Confirms every suggested callout in one region in a single write.
    The per-box checks still happen one at a time in the UI."""
    _check_region_belongs(body.region_id, version)
    now = datetime.now(timezone.utc)
    ids = [
        e["id"] for e in version.get("entities", [])
        if e.get("region_id") == str(body.region_id) and e.get("status") == "suggested"
        and (not body.skip_warnings or not e.get("warnings"))
    ]
    if ids:
        await db["annotation_versions"].update_one(
            {"_id": str(version["_id"])},
            {"$set": {"entities.$[e].status": "confirmed", "entities.$[e].updated_at": now}},
            array_filters=[{"e.id": {"$in": ids}}],
        )
    return {"confirmed": len(ids)}


@router.delete("/{entity_id}", status_code=204)
async def delete_entity(
    entity_id: uuid.UUID,
    version: dict[str, Any] = Depends(get_editable_annotation_version_or_404),
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> None:
    _find_entity(version, entity_id)
    await db["annotation_versions"].update_one(
        {"_id": str(version["_id"])},
        {"$pull": {"entities": {"id": str(entity_id)}}},
    )
