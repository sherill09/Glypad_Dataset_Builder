"""
Helper converters from MongoDB documents to Pydantic Out schemas.
"""

import uuid
from datetime import datetime, timezone
from typing import Any

from app.schemas.annotation_version import AnnotationVersionOut
from app.schemas.entity import EntityOut
from app.schemas.region import RegionOut


def region_to_out(r: dict[str, Any], version_id: str) -> RegionOut:
    return RegionOut(
        id=uuid.UUID(str(r["id"])),
        annotation_version_id=uuid.UUID(version_id),
        type=r.get("type", "view"),
        caption=r.get("caption"),
        notes=r.get("notes"),
        status=r.get("status", "not_started"),
        entities_status=r.get("entities_status", "not_started"),
        points=r["points"],
        source=r.get("source", "human"),
        created_at=r.get("created_at") or datetime.now(timezone.utc),
        updated_at=r.get("updated_at") or datetime.now(timezone.utc),
        extraction_status=r.get("extraction_status"),
        extraction_note=r.get("extraction_note"),
    )


def entity_to_out(e: dict[str, Any], version_id: str) -> EntityOut:
    from app.services.entity_taxonomy import resolve_stored

    kind, subtype = resolve_stored(e)
    return EntityOut(
        id=uuid.UUID(str(e["id"])),
        annotation_version_id=uuid.UUID(version_id),
        region_id=uuid.UUID(str(e["region_id"])) if e.get("region_id") else None,
        kind=kind,
        subtype=subtype,
        bbox=e["bbox"],
        text=e.get("text"),
        raw_text=e.get("raw_text"),
        parsed=e.get("parsed") or {},
        warnings=e.get("warnings") or [],
        payload=e.get("payload") or {},
        status=e.get("status") or "confirmed",
        source=e.get("source") or "manual",
        created_by_email=e.get("created_by_email"),
        created_at=e.get("created_at") or datetime.now(timezone.utc),
        updated_at=e.get("updated_at") or datetime.now(timezone.utc),
    )


def annotation_version_to_out(version: dict[str, Any]) -> AnnotationVersionOut:
    v_id = str(version["_id"])
    return AnnotationVersionOut(
        id=uuid.UUID(v_id),
        drawing_id=uuid.UUID(str(version["drawing_id"])),
        version_number=version["version_number"],
        status=version["status"],
        is_current=version["is_current"],
        standard=version.get("standard"),
        units=version.get("units"),
        discipline=version.get("discipline"),
        scale=version.get("scale"),
        general_tolerance_grade=version.get("general_tolerance_grade"),
        created_by_email=version.get("created_by_email"),
        created_at=version["created_at"],
        approved_by_email=version.get("approved_by_email"),
        approved_at=version.get("approved_at"),
        superseded_by_id=uuid.UUID(str(version["superseded_by_id"])) if version.get("superseded_by_id") else None,
        regions=[region_to_out(r, v_id) for r in version.get("regions", [])],
        entities=[entity_to_out(e, v_id) for e in version.get("entities", [])],
    )
