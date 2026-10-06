"""
Builds the COCO-style dataset export backed by MongoDB via Motor.
"""

from dataclasses import dataclass
from typing import Any

from motor.motor_asyncio import AsyncIOMotorDatabase

from app.services.entity_taxonomy import KINDS, SUBTYPES, resolve_stored
from app.schemas.region import REGION_TYPES


@dataclass
class ExportResult:
    images: list[dict[str, Any]]
    annotations: list[dict[str, Any]]
    categories: dict[str, list[str]]

    @property
    def drawing_count(self) -> int:
        return len(self.images)

    @property
    def annotation_count(self) -> int:
        return len(self.annotations)

    def as_dict(self) -> dict[str, Any]:
        return {"images": self.images, "annotations": self.annotations, "categories": self.categories}


async def build_export(db: AsyncIOMotorDatabase) -> ExportResult:
    images: list[dict[str, Any]] = []
    annotations: list[dict[str, Any]] = []
    next_annotation_id = 1

    # Find all current and approved annotation versions
    cursor = db["annotation_versions"].find({"is_current": True, "status": "approved"}).sort("created_at", 1)
    current_versions = await cursor.to_list(length=10000)

    for current in current_versions:
        drawing_id = str(current["drawing_id"])
        drawing = await db["drawings"].find_one({"_id": drawing_id})
        if not drawing:
            continue

        images.append(
            {
                "id": drawing_id,
                "file_name": drawing["original_filename"],
                "source_link": drawing.get("source_link"),
                "content_hash": drawing["content_hash"],
                "annotation_version_id": str(current["_id"]),
                "version_number": current["version_number"],
                "standard": current.get("standard"),
                "units": current.get("units"),
                "discipline": current.get("discipline"),
                "scale": current.get("scale"),
            }
        )

        for region in current.get("regions", []):
            annotations.append(
                {
                    "id": next_annotation_id,
                    "image_id": drawing_id,
                    "layer": "region",
                    "category": region.get("type", "view"),
                    "bbox": region["points"],
                    "payload": {
                        "caption": region.get("caption"),
                        "notes": region.get("notes"),
                        "status": region.get("status"),
                    },
                }
            )
            next_annotation_id += 1

        for entity in current.get("entities", []):
            annotations.append(
                {
                    "id": next_annotation_id,
                    "image_id": drawing_id,
                    "layer": "entity",
                    "kind": resolve_stored(entity)[0],
                    "subtype": resolve_stored(entity)[1],
                    "bbox": entity["bbox"],
                    "text": entity.get("text"),
                    "raw_text": entity.get("raw_text"),
                    "parsed": entity.get("parsed") or {},
                    "payload": entity.get("payload", {}),
                    "source": entity.get("source", "manual"),
                    "region_id": str(entity["region_id"]) if entity.get("region_id") else None,
                }
            )
            next_annotation_id += 1

    return ExportResult(
        images=images,
        annotations=annotations,
        categories={"regions": REGION_TYPES, "entities": list(KINDS), "entity_subtypes": SUBTYPES},
    )
