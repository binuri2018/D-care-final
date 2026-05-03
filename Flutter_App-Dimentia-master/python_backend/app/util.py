from datetime import datetime, timezone
from typing import Any

from bson import ObjectId


def oid_str(v: Any) -> str:
    if isinstance(v, ObjectId):
        return str(v)
    if v is None:
        return ""
    return str(v)


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def pairing_tracking_status(doc: dict | None) -> str:
    """Read location-sharing state from a pairings document (camelCase or legacy snake_case)."""
    if not doc:
        return "not_requested"
    v = doc.get("trackingStatus")
    if v is None:
        v = doc.get("tracking_status")
    if v is None:
        return "not_requested"
    s = str(v).strip().lower()
    if s in ("approved", "pending", "rejected", "not_requested"):
        return s
    return "not_requested"


def normalize_user_role(raw: object) -> str:
    s = str(raw or "").strip().lower()
    return s if s in ("patient", "guardian") else "patient"


def serialize_user(doc: dict) -> dict:
    return {
        "id": oid_str(doc.get("_id")),
        "fullName": doc.get("fullName", ""),
        "email": doc.get("email", ""),
        "role": normalize_user_role(doc.get("role")),
    }


def serialize_alert(doc: dict) -> dict:
    meta = doc.get("metadata") or {}
    if not isinstance(meta, dict):
        meta = {}
    return {
        "_id": oid_str(doc.get("_id")),
        "type": doc.get("type"),
        "severity": doc.get("severity"),
        "message": doc.get("message"),
        "acknowledged": bool(doc.get("acknowledged")),
        "createdAt": doc.get("createdAt").isoformat() if doc.get("createdAt") else None,
        "metadata": meta,
    }
