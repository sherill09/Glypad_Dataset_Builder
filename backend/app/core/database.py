"""
MongoDB async connection and database access layer using Motor (async PyMongo).

Provides:
- `client`: AsyncIOMotorClient instance with connection pooling.
- `get_db()`: FastAPI dependency yielding the database instance for async routes.
- `init_db()`: Initializes MongoDB indexes (unique content_hash, email, etc.) on startup.
- `close_db()`: Gracefully closes the connection pool on app shutdown.
"""

import logging
from typing import AsyncGenerator

from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase

from app.core.config import settings

logger = logging.getLogger(__name__)

client_kwargs: dict = {
    "maxPoolSize": 100,
    "minPoolSize": 10,
    "uuidRepresentation": "standard",
}

try:
    import certifi
    client_kwargs["tlsCAFile"] = certifi.where()
except ImportError:
    pass

# Connection pool with maxPoolSize=100 for high multi-user concurrency
client: AsyncIOMotorClient = AsyncIOMotorClient(
    settings.MONGODB_URL,
    **client_kwargs,
)

database: AsyncIOMotorDatabase = client[settings.MONGODB_DB_NAME]


async def get_db() -> AsyncGenerator[AsyncIOMotorDatabase, None]:
    """FastAPI dependency to inject the async MongoDB database instance."""
    yield database


async def init_db() -> None:
    """Creates indexes to guarantee data integrity, uniqueness, and high performance."""
    try:
        # Users: Unique index on email
        await database["users"].create_index("email", unique=True)

        # Drawings: Unique index on content_hash (guarantees no duplicate drawings under concurrent uploads)
        await database["drawings"].create_index("content_hash", unique=True)
        await database["drawings"].create_index("created_at")

        # Annotation versions: Unique compound index on drawing_id + version_number
        await database["annotation_versions"].create_index(
            [("drawing_id", 1), ("version_number", 1)],
            unique=True,
        )
        await database["annotation_versions"].create_index([("drawing_id", 1), ("is_current", 1)])

        # Dataset versions: Index on version_number
        await database["dataset_versions"].create_index("version_number", unique=True)

        logger.info("MongoDB indexes verified successfully.")
    except Exception as exc:
        logger.error("Failed to initialize MongoDB indexes: %s", exc)


async def close_db() -> None:
    """Closes the MongoDB connection pool."""
    client.close()
    logger.info("MongoDB client connection closed.")
