"""
The 30-day working-file TTL cleanup backed by MongoDB via Motor.
"""

import logging
from datetime import datetime, timedelta, timezone

from motor.motor_asyncio import AsyncIOMotorDatabase

from app.core.config import settings
from app.services.storage import get_storage

logger = logging.getLogger(__name__)

EXPIRED_NOTE = "Expired after {days} days in the working cache — re-upload the same file to view it again."


async def expire_old_files(db: AsyncIOMotorDatabase, ttl_days: int | None = None) -> int:
    """Returns how many drawings' cached files were just expired."""
    days = ttl_days if ttl_days is not None else settings.WORKING_FILE_TTL_DAYS
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)

    cursor = db["drawings"].find({"stored": True, "file_cached_at": {"$lt": cutoff}})
    expired = await cursor.to_list(length=1000)

    for drawing in expired:
        storage_key = drawing.get("storage_key")
        if storage_key:
            try:
                get_storage().delete(storage_key)
            except Exception:
                logger.warning("Could not delete expired storage key %s for drawing %s", storage_key, drawing["_id"])
        await db["drawings"].update_one(
            {"_id": drawing["_id"]},
            {
                "$set": {
                    "storage_key": None,
                    "stored": False,
                    "storage_note": EXPIRED_NOTE.format(days=days),
                }
            },
        )

    return len(expired)
