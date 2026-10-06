"""
The FastAPI application entrypoint. Run it with:

    uvicorn app.main:app --reload

(from inside the backend/ folder, with your virtual environment active).
"""

from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import ai, annotation_versions, auth, dataset_versions, drawings, entities, extraction, health, regions
from app.core.config import settings
from app.core.database import close_db, init_db
from app.core.scheduler import start_cleanup_scheduler, stop_cleanup_scheduler


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    await init_db()
    # The 30-day working-file TTL cleanup background task
    start_cleanup_scheduler()
    yield
    stop_cleanup_scheduler()
    await close_db()


app = FastAPI(
    title="Glypad Dataset Builder API",
    description="Upload, classify, trace and approve 2D/3D CAD files for a model-training dataset.",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router, prefix="/api")
app.include_router(auth.router, prefix="/api")
app.include_router(drawings.router, prefix="/api")
app.include_router(annotation_versions.router, prefix="/api")
app.include_router(regions.router, prefix="/api")
app.include_router(entities.router, prefix="/api")
app.include_router(extraction.router, prefix="/api")
app.include_router(ai.router, prefix="/api")
app.include_router(dataset_versions.router, prefix="/api")
