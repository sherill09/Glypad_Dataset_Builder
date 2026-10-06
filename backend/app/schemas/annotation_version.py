"""
Response/update shapes for an annotation version's own fields —
principally the Layer 1 drawing-level metadata (IMPLEMENTATION_PLAN.md §4,
§5 step 3). Region/entity CRUD live in their own schema modules; this one
is just about the annotation_versions row itself.
"""

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.entity import EntityOut
from app.schemas.region import RegionOut

STANDARDS = ["iso", "asme"]

# ISO 2768's general-tolerance letter grades (PHASE2_IMPLEMENTATION_PLAN.md
# §3.4) — only meaningful when standard == "iso", but not enforced as
# conditional here; nothing stops it staying set if standard is later cleared.
GENERAL_TOLERANCE_GRADES = ["f", "m", "c", "v"]


class AnnotationVersionUpdate(BaseModel):
    """Layer 1 metadata only — the fields captured before any boxes are
    drawn. Status changes go through their own actions (approve, in a later
    slice), not this general-purpose patch."""

    standard: str | None = Field(default=None, pattern="^(iso|asme)$")
    units: str | None = None
    discipline: str | None = None
    scale: str | None = None
    general_tolerance_grade: str | None = Field(default=None, pattern="^(f|m|c|v)$")


class AnnotationVersionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    drawing_id: uuid.UUID
    version_number: int
    status: str
    is_current: bool

    standard: str | None
    units: str | None
    discipline: str | None
    scale: str | None
    general_tolerance_grade: str | None

    created_by_email: str | None = None
    created_at: datetime
    approved_by_email: str | None = None
    approved_at: datetime | None
    superseded_by_id: uuid.UUID | None

    regions: list[RegionOut] = []
    entities: list[EntityOut] = []


class AnnotationVersionDeleteResult(BaseModel):
    """What the frontend needs after deleting a version, to know where to
    navigate next (PHASE2_IMPLEMENTATION_PLAN.md §4.3, §5)."""

    drawing_deleted: bool
    drawing_id: uuid.UUID
    new_current_version_id: uuid.UUID | None
