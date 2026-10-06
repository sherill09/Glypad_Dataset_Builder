"""
Pydantic shapes for Layer 3 -- the callouts inside a coarse region.

Each entity has a *kind* (what sort of callout it is) and an optional
*subtype* (which specific kind of that callout). The vocabulary lives in
app/services/entity_taxonomy.py. `text` is what the person confirms as
being on the sheet; `parsed`, `warnings` and `raw_text` are derived by the
server, never written by the client.
"""

import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.schemas.region import Point, _check_points
from app.services.entity_taxonomy import KINDS, validate_kind_subtype

KIND_PATTERN = "^(" + "|".join(KINDS) + ")$"


class EntityBase(BaseModel):
    kind: str = Field(default="other", pattern=KIND_PATTERN)
    subtype: str | None = None
    region_id: uuid.UUID | None = None
    bbox: list[Point]
    text: str | None = None
    payload: dict[str, Any] = Field(default_factory=dict)
    # "suggested" = proposed by text extraction, waiting for review;
    # "confirmed" = named by a person, or drawn by hand.
    status: str = Field(default="confirmed", pattern="^(suggested|confirmed)$")
    # Where the box came from: "manual" | "vector" | "ocr".
    source: str = Field(default="manual", pattern="^(manual|vector|ocr)$")

    _validate_bbox = field_validator("bbox")(_check_points)

    @model_validator(mode="after")
    def _check_subtype(self):
        validate_kind_subtype(self.kind, self.subtype)
        return self


class EntityCreate(EntityBase):
    pass


class EntityUpdate(BaseModel):
    kind: str | None = Field(default=None, pattern=KIND_PATTERN)
    subtype: str | None = None
    region_id: uuid.UUID | None = None
    bbox: list[Point] | None = None
    text: str | None = None
    payload: dict[str, Any] | None = None
    status: str | None = Field(default=None, pattern="^(suggested|confirmed)$")

    _validate_bbox = field_validator("bbox")(_check_points)


class EntityOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    annotation_version_id: uuid.UUID
    region_id: uuid.UUID | None = None
    kind: str
    subtype: str | None = None
    bbox: list[Point]
    text: str | None = None
    raw_text: str | None = None
    parsed: dict[str, Any] = Field(default_factory=dict)
    warnings: list[str] = Field(default_factory=list)
    payload: dict[str, Any] = Field(default_factory=dict)
    status: str = "confirmed"
    source: str = "manual"
    created_by_email: str | None = None
    created_at: datetime
    updated_at: datetime


class ExtractionRegionResult(BaseModel):
    region_id: uuid.UUID
    method: str  # "vector" | "ocr" | "none" | "manual_fallback"
    created: int


class ExtractionResult(BaseModel):
    created: int
    note: str | None = None
    regions: list[ExtractionRegionResult]
    # True while a background extraction job is still reading regions.
    running: bool = False
