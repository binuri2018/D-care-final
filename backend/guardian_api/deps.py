from typing import Annotated

from bson import ObjectId
from bson.errors import InvalidId
from fastapi import Depends, Header, HTTPException, status

from .auth_utils import safe_decode
from .config import Settings
from .db import get_db
from .util import normalize_user_role

settings = Settings()


def get_settings() -> Settings:
    return settings


async def get_current_user(
    authorization: Annotated[str | None, Header()] = None,
) -> dict:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Authentication required")
    token = authorization.split(" ", 1)[1].strip()
    payload = safe_decode(settings, token)
    if not payload or "sub" not in payload:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or expired token")
    try:
        oid = ObjectId(payload["sub"])
    except InvalidId:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid token subject")
    db = get_db()
    user = await db.users.find_one({"_id": oid})
    if not user:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "User not found")
    role = normalize_user_role(user.get("role"))
    return {
        "_id": oid,
        "id": str(oid),
        "fullName": user.get("fullName", ""),
        "email": user.get("email", ""),
        "role": role,
    }


async def optional_user(
    authorization: Annotated[str | None, Header()] = None,
) -> dict | None:
    if not authorization or not authorization.lower().startswith("bearer "):
        return None
    token = authorization.split(" ", 1)[1].strip()
    payload = safe_decode(settings, token)
    if not payload or "sub" not in payload:
        return None
    try:
        oid = ObjectId(payload["sub"])
    except InvalidId:
        return None
    db = get_db()
    user = await db.users.find_one({"_id": oid})
    if not user:
        return None
    role = normalize_user_role(user.get("role"))
    return {
        "_id": oid,
        "id": str(oid),
        "fullName": user.get("fullName", ""),
        "email": user.get("email", ""),
        "role": role,
    }
