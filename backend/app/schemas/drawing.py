"""
Response shapes for the drawing-upload + dedup flow (IMPLEMENTATION_PLAN.md
§5 steps 1-2). Read-only for now — there's no "create a drawing by hand"
action, only upload — so there's no DrawingCreate/DrawingUpdate yet.
"""

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict


class AnnotationVersionSummary(BaseModel):
    """Just enough to answer "has this drawing been annotated before, by
    whom, and what state is it in" — the dedup prompt's whole job."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    version_number: int
    status: str
    is_current: bool
    created_by_email: str | None = None
    created_at: datetime
    approved_at: datetime | None = None
    superseded_by_id: uuid.UUID | None = None


class DrawingOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    content_hash: str
    original_filename: str
    source_link: str | None
    category: str
    format: str
    complexity: str
    page_count: int = 1
    has_vector_geo: bool = False
    has_raster_geo: bool = False
    has_vector_text: bool = False
    has_raster_text: bool = False
    stored: bool
    storage_note: str | None
    first_uploaded_by_email: str | None = None
    created_at: datetime
    version_count: int = 1

    annotation_versions: list[AnnotationVersionSummary] = []


class DrawingUpdate(BaseModel):
    """The only thing a person edits directly on a drawing after upload —
    the Drive URL, so the export six months from now can still find the
    original file (§3). Everything else on a drawing (hash, classification)
    is fixed at upload time."""

    source_link: str | None = None


class DrawingUploadResult(BaseModel):
    """`created=True`: a brand-new drawing (and its first annotation
    version) were just made. `created=False`: this exact content hash
    already existed — `drawing.annotation_versions` is what the "already
    annotated — view it, or start a new version?" prompt is built from
    (§5 step 2) — follow a version's own link to actually start a new one
    (POST /annotation-versions/{id}/start-new-version, slice 6)."""

    created: bool
    drawing: DrawingOut
