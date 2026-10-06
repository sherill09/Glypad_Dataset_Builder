"""
"Proceed to entity annotation" reads the sheet's text and turns each text line
that falls inside a region into a *suggested* callout.

This runs as a background job, not inside the request. The request claims the
regions and returns straight away; the job saves each region's result as soon
as it's ready. So a page reload or a slow OCR can't lose the work:

- A region is claimed (extraction_status "running") before the job starts, so a
  second request never duplicates it.
- A claim older than STALE_CLAIM_SECONDS (the server restarted mid-job) is
  retried by the next request.
- Once a region is finished (extraction_method set), it's never read again.
"""

import asyncio
import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, Depends
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.api.deps import get_current_user, get_db, get_editable_annotation_version_or_404
from app.schemas.entity import ExtractionRegionResult, ExtractionResult
from app.services.callout_parser import callout_for_extraction
from app.services.storage import get_storage
from app.services.text_extraction import (
    ExtractionUnavailable,
    TransientExtractionError,
    extract_candidates,
    point_in_polygon,
)

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/annotation-versions/{annotation_version_id}",
    tags=["extraction"],
    dependencies=[Depends(get_current_user)],
)

STALE_CLAIM_SECONDS = 600
_background_tasks: set[asyncio.Task] = set()


def _is_claimable(region: dict[str, Any], now: datetime) -> bool:
    if region.get("extraction_method"):
        return False
    if region.get("extraction_status") == "running":
        started = region.get("extraction_started_at")
        if started is None:
            return False
        if started.tzinfo is None:
            started = started.replace(tzinfo=timezone.utc)
        return now - started > timedelta(seconds=STALE_CLAIM_SECONDS)
    return True


def _load_candidates(drawing: dict[str, Any] | None) -> tuple[list, str | None, bool]:
    """Returns (candidates, note, transient). A note means extraction couldn't run.
    transient=True means it may work next time, so regions are retried, not given
    a permanent manual fallback."""
    if drawing is None or not drawing.get("stored") or not drawing.get("storage_key"):
        return [], "This drawing's bytes aren't cached, so its text can't be read", False
    try:
        data = get_storage().read(drawing["storage_key"])
        return extract_candidates(data, drawing.get("format", "")), None, False
    except TransientExtractionError as exc:
        return [], str(exc), True
    except ExtractionUnavailable as exc:
        return [], str(exc), False
    except Exception:
        logger.exception("Could not read drawing for extraction")
        return [], "The drawing file could not be read", False


async def _run_extraction(
    db: AsyncIOMotorDatabase,
    version_id: str,
    drawing_id: str,
    region_ids: list[str],
    user_id: str,
    user_email: str | None,
) -> None:
    """The background job. Every claimed region ends with a final state, even when
    something goes wrong, so nothing is left half-finished."""
    try:
        drawing = await db["drawings"].find_one({"_id": drawing_id})
        candidates, note, transient = await asyncio.to_thread(_load_candidates, drawing)
        if transient:
            # Nothing was read because of a temporary fault: release the claims for a retry.
            await db["annotation_versions"].update_many(
                {"_id": version_id},
                {"$set": {"regions.$[r].extraction_status": "failed", "regions.$[r].extraction_note": note}},
                array_filters=[{"r.id": {"$in": region_ids}}],
            )
            return
        version = await db["annotation_versions"].find_one({"_id": version_id})
        if version is None:
            return
        regions_by_id = {str(r["id"]): r for r in version.get("regions", [])}
        centers = [((c.bbox[0][0] + c.bbox[2][0]) / 2, (c.bbox[0][1] + c.bbox[2][1]) / 2) for c in candidates]
        existing = {
            (e.get("text"), round(e["bbox"][0][0]), round(e["bbox"][0][1]))
            for e in version.get("entities", [])
            if e.get("text")
        }
        claimed: set[int] = set()

        for rid in region_ids:
            region = regions_by_id.get(rid)
            if region is None:
                continue
            now = datetime.now(timezone.utc)
            new_entities: list[dict[str, Any]] = []
            method = "manual_fallback" if note is not None else "none"
            if note is None:
                for idx, cand in enumerate(candidates):
                    if idx in claimed:
                        continue
                    cx, cy = centers[idx]
                    if not point_in_polygon(cx, cy, region["points"]):
                        continue
                    if (cand.text, round(cand.bbox[0][0]), round(cand.bbox[0][1])) in existing:
                        continue
                    claimed.add(idx)
                    reading = callout_for_extraction(cand.text, is_frame=cand.is_frame, region_type=region.get("type"))
                    new_entities.append({
                        "id": str(uuid.uuid4()),
                        "region_id": rid,
                        "kind": reading.kind,
                        "subtype": reading.subtype,
                        "bbox": [list(p) for p in cand.bbox],
                        "payload": {},
                        "text": cand.text,
                        "raw_text": cand.text,
                        "parsed": reading.parsed,
                        "warnings": reading.warnings,
                        "status": "suggested",
                        "source": cand.source,
                        "created_by_id": user_id,
                        "created_by_email": user_email,
                        "created_at": now,
                        "updated_at": now,
                    })
                if new_entities:
                    sources = {e["source"] for e in new_entities}
                    method = "vector+ocr" if len(sources) > 1 else new_entities[0]["source"]

            # Write the callouts, then the region's final state.
            if new_entities:
                await db["annotation_versions"].update_one(
                    {"_id": version_id},
                    {"$push": {"entities": {"$each": new_entities}}},
                )
            await db["annotation_versions"].update_one(
                {"_id": version_id, "regions.id": rid},
                {"$set": {
                    "regions.$.extraction_method": method,
                    "regions.$.extraction_status": "done",
                    "regions.$.extraction_note": note,
                    "regions.$.extraction_at": now,
                }},
            )
    except Exception:
        logger.exception("Text extraction job failed for version %s", version_id)
        # Release the claims this job still holds, so the next request can retry them.
        await db["annotation_versions"].update_many(
            {"_id": version_id},
            {"$set": {"regions.$[r].extraction_status": "failed"}},
            array_filters=[{"r.id": {"$in": region_ids}, "r.extraction_status": "running"}],
        )


@router.post("/extract-entities", response_model=ExtractionResult)
async def extract_entities_for_version(
    version: dict[str, Any] = Depends(get_editable_annotation_version_or_404),
    db: AsyncIOMotorDatabase = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> ExtractionResult:
    v_id = str(version["_id"])
    now = datetime.now(timezone.utc)
    to_claim = [r for r in version.get("regions", []) if _is_claimable(r, now)]

    claimed_ids: list[str] = []
    for region in to_claim:
        rid = str(region["id"])
        result = await db["annotation_versions"].update_one(
            {"_id": v_id, "regions": {"$elemMatch": {"id": rid}}},
            {"$set": {"regions.$.extraction_status": "running", "regions.$.extraction_started_at": now}},
        )
        if result.modified_count == 1:
            claimed_ids.append(rid)

    if claimed_ids:
        task = asyncio.create_task(
            _run_extraction(
                db,
                v_id,
                str(version["drawing_id"]),
                claimed_ids,
                str(current_user["id"]),
                current_user.get("email"),
            )
        )
        _background_tasks.add(task)
        task.add_done_callback(_background_tasks.discard)

    running = claimed_ids or [
        str(r["id"]) for r in version.get("regions", []) if r.get("extraction_status") == "running"
    ]
    return ExtractionResult(
        created=0,
        note=None,
        regions=[ExtractionRegionResult(region_id=uuid.UUID(rid), method="running", created=0) for rid in running],
        running=bool(running),
    )
