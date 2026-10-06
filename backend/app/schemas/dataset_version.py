"""
Shapes for the export screen (IMPLEMENTATION_PLAN.md §5 step 8, §4
`dataset_versions`). The export content itself is deliberately untyped
(`dict`) rather than a strict Pydantic model — it's a flexible,
COCO-flavored structure (see app/services/export.py), and the plan treats
flexibility there as a feature, not something to constrain at the schema
level.
"""

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict


class DatasetVersionCreate(BaseModel):
    notes: str | None = None


class DatasetVersionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    version_number: int
    created_by_email: str | None = None
    created_at: datetime
    drawing_count: int
    annotation_count: int
    notes: str | None


class ExportPreviewOut(BaseModel):
    """What "Create dataset version" would include right now, without
    actually creating a dataset_versions row — lets the export screen show
    a live count before the person commits to it."""

    drawing_count: int
    annotation_count: int


class DatasetVersionExportOut(BaseModel):
    """The response to an actual export trigger: the metadata row that was
    just recorded, plus the export content itself for the browser to turn
    into a file download. The content is never stored server-side."""

    dataset_version: DatasetVersionOut
    export: dict
