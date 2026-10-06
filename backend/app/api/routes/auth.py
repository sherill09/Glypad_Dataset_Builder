"""
Sign-up, log-in, and "who am I" endpoints backed by MongoDB via Motor.
"""

import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.api.deps import get_current_user, get_db
from app.core.security import create_access_token, hash_password, verify_password
from app.schemas.auth import LoginRequest, RegisterRequest, TokenResponse, UserOut

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register", response_model=TokenResponse, status_code=201)
async def register(
    payload: RegisterRequest, db: AsyncIOMotorDatabase = Depends(get_db)
) -> TokenResponse:
    existing = await db["users"].find_one({"email": payload.email})
    if existing is not None:
        raise HTTPException(status_code=409, detail="An account with this email already exists")

    user_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)
    user_doc = {
        "_id": user_id,
        "email": payload.email,
        "hashed_password": hash_password(payload.password),
        "display_name": payload.display_name,
        "is_active": True,
        "created_at": now,
    }
    await db["users"].insert_one(user_doc)

    token = create_access_token(user_id)
    return TokenResponse(
        access_token=token,
        user=UserOut(
            id=uuid.UUID(user_id),
            email=user_doc["email"],
            display_name=user_doc["display_name"],
            created_at=user_doc["created_at"],
        ),
    )


@router.post("/login", response_model=TokenResponse)
async def login(
    payload: LoginRequest, db: AsyncIOMotorDatabase = Depends(get_db)
) -> TokenResponse:
    user = await db["users"].find_one({"email": payload.email})
    if user is None or not verify_password(payload.password, user["hashed_password"]):
        raise HTTPException(status_code=401, detail="Incorrect email or password")
    if not user.get("is_active", True):
        raise HTTPException(status_code=403, detail="This account has been deactivated")

    token = create_access_token(user["_id"])
    return TokenResponse(
        access_token=token,
        user=UserOut(
            id=uuid.UUID(user["_id"]),
            email=user["email"],
            display_name=user["display_name"],
            created_at=user["created_at"],
        ),
    )


@router.get("/me", response_model=UserOut)
async def read_current_user(user: dict[str, Any] = Depends(get_current_user)) -> UserOut:
    return UserOut(
        id=uuid.UUID(user["_id"]),
        email=user["email"],
        display_name=user["display_name"],
        created_at=user["created_at"],
    )
