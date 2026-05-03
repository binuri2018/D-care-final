from typing import Annotated

from bson import ObjectId
from bson.errors import InvalidId
from fastapi import APIRouter, Body, Depends, HTTPException, status

from ..db import get_db
from ..deps import get_current_user
from ..util import now_utc, oid_str, pairing_tracking_status

router = APIRouter(prefix="/heartbeats", tags=["heartbeats"])


async def _require_tracking_approved(db, patient_oid: ObjectId) -> None:
    p = await db.pairings.find_one(
        {
            "patientId": patient_oid,
            "$or": [
                {"trackingStatus": "approved"},
                {"tracking_status": "approved"},
            ],
        }
    )
    if not p:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Location sharing is pending patient approval",
        )


@router.post("", include_in_schema=False)
@router.post("/")
async def post_heartbeat(
    body: Annotated[dict, Body()],
    user: Annotated[dict, Depends(get_current_user)],
):
    if user["role"] != "patient":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only patients can send heartbeats")
    await _require_tracking_approved(get_db(), user["_id"])

    lat = body.get("latitude")
    lng = body.get("longitude")
    battery = body.get("batteryLevel", 100)
    try:
        lat_f = float(lat)
        lng_f = float(lng)
    except (TypeError, ValueError):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "latitude and longitude required")

    db = get_db()
    doc = {
        "patientId": user["_id"],
        "latitude": lat_f,
        "longitude": lng_f,
        "batteryLevel": int(battery) if battery is not None else 100,
        "createdAt": now_utc(),
    }
    await db.heartbeats.insert_one(doc)
    return {"message": "Heartbeat recorded"}


@router.get("/latest/{patient_id}")
async def latest_heartbeat(patient_id: str, user: Annotated[dict, Depends(get_current_user)]):
    if user["role"] != "guardian":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only guardians can view patient heartbeats")
    try:
        pid = ObjectId(patient_id)
    except InvalidId:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid patient id")

    db = get_db()
    pairing = await db.pairings.find_one({"guardianId": user["_id"], "patientId": pid})
    if not pairing:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not paired with this patient")
    if pairing_tracking_status(pairing) != "approved":
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Location sharing is pending patient approval",
        )

    doc = await db.heartbeats.find_one({"patientId": pid}, sort=[("createdAt", -1)])
    if not doc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No heartbeats yet")
    return {
        "latitude": doc.get("latitude"),
        "longitude": doc.get("longitude"),
        "batteryLevel": doc.get("batteryLevel"),
        "createdAt": doc.get("createdAt").isoformat() if doc.get("createdAt") else None,
        "patientId": oid_str(doc.get("patientId")),
    }
