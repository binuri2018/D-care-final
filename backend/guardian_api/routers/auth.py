from typing import Annotated

from fastapi import APIRouter, Body, Depends, HTTPException, status
from pymongo.errors import DuplicateKeyError

from ..auth_utils import create_token, hash_password, verify_password
from ..db import get_db
from ..deps import get_settings
from ..config import Settings
from ..util import now_utc, serialize_user

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register")
async def register(
    body: Annotated[dict, Body()],
    settings: Settings = Depends(get_settings),
):
    full_name = (body.get("fullName") or "").strip()
    email = (body.get("email") or "").strip().lower()
    password = body.get("password") or ""
    role = str(body.get("role") or "patient").strip().lower()
    if role not in ("patient", "guardian"):
        role = "patient"
    if not full_name or not email or len(password) < 6:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid registration payload")

    db = get_db()
    existing = await db.users.find_one({"email": email})
    if existing:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Email already registered")

    doc = {
        "fullName": full_name,
        "email": email,
        "passwordHash": hash_password(settings, password),
        "role": role,
        "createdAt": now_utc(),
    }
    try:
        res = await db.users.insert_one(doc)
    except DuplicateKeyError:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Email already registered")
    doc["_id"] = res.inserted_id
    token = create_token(settings, str(res.inserted_id), role)
    return {"token": token, "user": serialize_user(doc)}


@router.post("/login")
async def login(
    body: Annotated[dict, Body()],
    settings: Settings = Depends(get_settings),
):
    email = (body.get("email") or "").strip().lower()
    password = body.get("password") or ""
    if not email or not password:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Email and password required")

    db = get_db()
    user = await db.users.find_one({"email": email})
    if not user or not verify_password(password, user.get("passwordHash", "")):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid credentials")

    role = str(user.get("role") or "patient").strip().lower()
    if role not in ("patient", "guardian"):
        role = "patient"
    token = create_token(settings, str(user["_id"]), role)
    return {"token": token, "user": serialize_user(user)}
