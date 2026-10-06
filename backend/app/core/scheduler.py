"""
Async cleanup background task for the 30-day working-file TTL using Motor.
"""

import asyncio
import logging

from app.core.config import settings
from app.core.database import database
from app.services.cleanup import expire_old_files

logger = logging.getLogger(__name__)

_cleanup_task: asyncio.Task | None = None


async def _periodic_cleanup() -> None:
    while True:
        try:
            count = await expire_old_files(database)
            if count:
                logger.info(
                    "Working-file cleanup: expired %d drawing(s) past the %d-day TTL",
                    count,
                    settings.WORKING_FILE_TTL_DAYS,
                )
        except asyncio.CancelledError:
            break
        except Exception:
            logger.exception("Working-file cleanup run failed")

        try:
            await asyncio.sleep(max(settings.CLEANUP_INTERVAL_HOURS, 1) * 3600)
        except asyncio.CancelledError:
            break


def start_cleanup_scheduler() -> None:
    global _cleanup_task
    if _cleanup_task is None or _cleanup_task.done():
        _cleanup_task = asyncio.create_task(_periodic_cleanup())


def stop_cleanup_scheduler() -> None:
    global _cleanup_task
    if _cleanup_task and not _cleanup_task.done():
        _cleanup_task.cancel()
