from fastapi import APIRouter

router = APIRouter(tags=["health"])


@router.get("/health")
def health_check() -> dict:
    """Simple endpoint to confirm the API is running. Useful for load
    balancers / uptime checks in production, and for a quick sanity check
    while developing."""
    return {"status": "ok"}
