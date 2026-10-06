"""
The two cryptographic building blocks authentication needs:

1. Password hashing — we never store what someone typed as their password,
   only a one-way hash of it (bcrypt). `verify_password` re-hashes a login
   attempt and compares hashes, never decrypts anything (hashing can't be
   reversed by design).
2. JWT ("JSON Web Token") access tokens — after a successful login, the
   server hands back a signed token instead of making the browser resend
   the password on every request. The token is just a small piece of text
   that says "this is user X, and this token is valid until time Y",
   signed with SECRET_KEY so nobody can forge or edit one without knowing
   that secret. The frontend stores it and sends it back on every request
   in an `Authorization: Bearer <token>` header (see api/deps.py).
"""

import uuid
from datetime import datetime, timedelta, timezone

import jwt
from passlib.context import CryptContext

from app.core.config import settings

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

ALGORITHM = "HS256"


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)


def create_access_token(user_id: uuid.UUID) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    payload = {"sub": str(user_id), "exp": expire}
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=ALGORITHM)


def decode_access_token(token: str) -> uuid.UUID | None:
    """Returns the user id the token was issued for, or None if the token
    is missing, expired, or was signed with a different SECRET_KEY."""
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[ALGORITHM])
        return uuid.UUID(payload["sub"])
    except (jwt.PyJWTError, KeyError, ValueError):
        return None
