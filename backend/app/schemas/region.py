"""
Pydantic "schemas" define the shape of data going in and out of the API.

These are deliberately kept separate from the SQLAlchemy models in
app/models/ — the model describes a database row, the schema describes an
API request/response. Keeping them separate means the API's shape doesn't
accidentally change just because the database table changes, and vice versa.
"""

import math
import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator

Point = list[float]  # [x, y]

REGION_TYPES = [
    "view",
    "section view",
    "detail view",
    "title block",
    "parts list",
    "dimension block",
    "notes",
    "revision table",  # named explicitly in IMPLEMENTATION_PLAN.md §5 step 4
    "other",
]

REGION_STATUSES = ["not_started", "in_progress", "done"]

# Same three states, tracked separately for Layer 3 (entity annotation
# inside this region) rather than Layer 2 (the region box itself).
# See PHASE2_IMPLEMENTATION_PLAN.md §4.1.
REGION_ENTITIES_STATUSES = REGION_STATUSES


def _check_points(points: list[Point] | None) -> list[Point] | None:
    """Regions are edited by dragging in the UI and those coordinates are
    saved as-is, so reject anything that couldn't be a real polygon."""
    if points is None:
        return points
    if len(points) < 3:
        raise ValueError("A region needs at least 3 points")
    for point in points:
        if len(point) != 2 or not all(math.isfinite(v) for v in point):
            raise ValueError("Each point must be a finite [x, y] pair")
    return points


class RegionBase(BaseModel):
    type: str = Field(default="view")
    caption: str | None = None
    notes: str | None = None
    status: str = Field(default="not_started", pattern="^(not_started|in_progress|done)$")
    entities_status: str = Field(default="not_started", pattern="^(not_started|in_progress|done)$")
    points: list[Point]

    _validate_points = field_validator("points")(_check_points)


class RegionCreate(RegionBase):
    source: str = Field(default="human", pattern="^(ai|human)$")


class RegionUpdate(BaseModel):
    type: str | None = None
    caption: str | None = None
    notes: str | None = None
    status: str | None = Field(default=None, pattern="^(not_started|in_progress|done)$")
    entities_status: str | None = Field(default=None, pattern="^(not_started|in_progress|done)$")
    points: list[Point] | None = None

    _validate_points = field_validator("points")(_check_points)


class RegionMerge(BaseModel):
    region_ids: list[uuid.UUID] = Field(min_length=2)


class RegionOut(RegionBase):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    annotation_version_id: uuid.UUID
    source: str
    created_at: datetime
    updated_at: datetime
    # Text extraction for this region: "running" while the background job reads it,
    # "done" once finished, "failed" if it hit an error (it will be retried).
    extraction_status: str | None = None
    extraction_note: str | None = None
