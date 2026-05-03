import secrets
import string
from datetime import datetime, timezone
from typing import Annotated

from bson import ObjectId
from bson.errors import InvalidId
from fastapi import APIRouter, Body, Depends, HTTPException, status

from ..db import get_db
from ..deps import get_current_user
from ..util import now_utc, oid_str, pairing_tracking_status

router = APIRouter(prefix="/pairing", tags=["pairing"])

_KEY_ALPHABET = string.ascii_uppercase + string.digits


def _rand_key(n: int = 8) -> str:
    return "".join(secrets.choice(_KEY_ALPHABET) for _ in range(n))


@router.post("/create-key")
async def create_key(user: Annotated[dict, Depends(get_current_user)]):
    if user["role"] != "patient":
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            f"Only patients can create pair keys (this account is: {user.get('role', 'unknown')}).",
        )
    db = get_db()
    key = _rand_key()
    await db.pair_keys.update_one(
        {"patientId": user["_id"]},
        {"$set": {"key": key, "patientId": user["_id"], "createdAt": now_utc()}},
        upsert=True,
    )
    return {"pairKey": key}


@router.post("/join")
async def join(
    body: Annotated[dict, Body()],
    user: Annotated[dict, Depends(get_current_user)],
):
    if user["role"] != "guardian":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only guardians can join with a pair key")
    raw = (body.get("pairKey") or "").strip().upper()
    if not raw:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "pairKey required")

    db = get_db()
    rec = await db.pair_keys.find_one({"key": raw})
    if not rec:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND,
            "No active pair code matches that value. Codes are single-use: after a successful join "
            "the code is cleared, and generating a new code on the patient device replaces the old one. "
            "Ask the patient to tap “Generate pair code” again and enter the new code.",
        )
    patient_id = rec.get("patientId")
    if not patient_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid pair key record")
    if patient_id == user["_id"]:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Cannot pair with yourself")

    await db.pairings.update_one(
        {"guardianId": user["_id"], "patientId": patient_id},
        {
            "$set": {
                "guardianId": user["_id"],
                "patientId": patient_id,
                "pairKey": raw,
                "trackingStatus": "not_requested",
                "updatedAt": now_utc(),
            }
        },
        upsert=True,
    )
    await db.pair_keys.delete_one({"_id": rec["_id"]})
    return {"message": "Paired successfully"}


def _best_pairing_row(rows: list[dict]) -> dict | None:
    """Pick the pairing row that best reflects location-sharing state (then most recently updated)."""
    if not rows:
        return None
    rank = {"approved": 3, "pending": 2, "rejected": 1, "not_requested": 0}
    epoch = datetime(1970, 1, 1, tzinfo=timezone.utc)

    def sort_key(r: dict) -> tuple:
        ts = pairing_tracking_status(r)
        return (rank.get(ts, 0), r.get("updatedAt") or epoch)

    return max(rows, key=sort_key)


@router.get("/status")
async def pairing_status(user: Annotated[dict, Depends(get_current_user)]):
    db = get_db()
    if user["role"] == "guardian":
        rows = await db.pairings.find({"guardianId": user["_id"]}).to_list(length=50)
        p = _best_pairing_row(rows)
        if not p:
            return {"paired": False, "patientId": None, "trackingStatus": "not_requested"}
        return {
            "paired": True,
            "patientId": oid_str(p.get("patientId")),
            "trackingStatus": pairing_tracking_status(p),
        }

    rows = await db.pairings.find({"patientId": user["_id"]}).to_list(length=50)
    p = _best_pairing_row(rows)
    if not p:
        return {"paired": False, "patientId": None, "trackingStatus": "not_requested"}
    return {
        "paired": True,
        "patientId": oid_str(p.get("patientId")),
        "trackingStatus": pairing_tracking_status(p),
    }


@router.post("/request-tracking")
async def request_tracking(
    body: Annotated[dict, Body()],
    user: Annotated[dict, Depends(get_current_user)],
):
    if user["role"] != "guardian":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only guardians can request tracking")
    pid = (body.get("patientId") or "").strip()
    if not pid:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "patientId required")
    try:
        patient_oid = ObjectId(pid)
    except InvalidId:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid patientId")

    db = get_db()
    pairing = await db.pairings.find_one({"guardianId": user["_id"], "patientId": patient_oid})
    if not pairing:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Patient is not paired with this guardian")

    ts = pairing_tracking_status(pairing)
    if ts == "approved":
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Location sharing is already enabled for this patient.",
        )
    if ts == "pending":
        dup = await db.tracking_requests.find_one(
            {
                "patientId": patient_oid,
                "guardianId": user["_id"],
                "status": "pending",
            }
        )
        if dup:
            return {"message": "A tracking request is already waiting for this patient."}

    await db.tracking_requests.insert_one(
        {
            "patientId": patient_oid,
            "guardianId": user["_id"],
            "status": "pending",
            "createdAt": now_utc(),
        }
    )
    await db.pairings.update_one(
        {"_id": pairing["_id"]},
        {"$set": {"trackingStatus": "pending", "updatedAt": now_utc()}},
    )
    return {"message": "Tracking request sent"}


@router.get("/pending-requests")
async def pending_requests(user: Annotated[dict, Depends(get_current_user)]):
    if user["role"] != "patient":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only patients can list pending requests")
    db = get_db()
    cursor = db.tracking_requests.find({"patientId": user["_id"], "status": "pending"})
    out = []
    async for req in cursor:
        g = await db.users.find_one({"_id": req["guardianId"]})
        gname = g.get("fullName", "Guardian") if g else "Guardian"
        out.append(
            {
                "_id": oid_str(req["_id"]),
                "guardianId": {"fullName": gname, "id": oid_str(req["guardianId"])},
            }
        )
    return out


@router.post("/confirm-tracking")
async def confirm_tracking(
    body: Annotated[dict, Body()],
    user: Annotated[dict, Depends(get_current_user)],
):
    if user["role"] != "patient":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only patients can confirm tracking")
    rid = (body.get("pairingId") or "").strip()
    action = (body.get("action") or "").strip().lower()
    if not rid or action not in ("approve", "reject"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "pairingId and action approve|reject required")
    try:
        req_oid = ObjectId(rid)
    except InvalidId:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid pairingId")

    db = get_db()
    req = await db.tracking_requests.find_one({"_id": req_oid, "patientId": user["_id"], "status": "pending"})
    if not req:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Request not found")

    new_status = "approved" if action == "approve" else "rejected"
    gid = req["guardianId"]
    pid = user["_id"]

    upd = await db.tracking_requests.update_one(
        {"_id": req_oid, "patientId": pid, "status": "pending"},
        {"$set": {"status": new_status, "resolvedAt": now_utc()}},
    )
    if upd.matched_count == 0:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Request not found or already resolved")

    if action == "approve":
        await db.tracking_requests.update_many(
            {
                "patientId": pid,
                "guardianId": gid,
                "status": "pending",
                "_id": {"$ne": req_oid},
            },
            {"$set": {"status": "cancelled", "resolvedAt": now_utc()}},
        )
    else:
        await db.tracking_requests.update_many(
            {"patientId": pid, "guardianId": gid, "status": "pending"},
            {"$set": {"status": "rejected", "resolvedAt": now_utc()}},
        )

    pairing = await db.pairings.find_one({"guardianId": gid, "patientId": pid})
    if pairing:
        ts = "approved" if action == "approve" else "rejected"
        await db.pairings.update_one(
            {"_id": pairing["_id"]},
            {"$set": {"trackingStatus": ts, "updatedAt": now_utc()}},
        )

    msg = "Tracking approved." if action == "approve" else "Tracking declined."
    return {"message": msg}
