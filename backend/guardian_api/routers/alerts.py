from typing import Annotated

from bson import ObjectId
from bson.errors import InvalidId
from fastapi import APIRouter, Body, Depends, HTTPException, Query, status

from ..db import get_db
from ..deps import get_current_user
from ..socket_manager import emit_alert_new
from ..util import now_utc, oid_str, serialize_alert

router = APIRouter(prefix="/alerts", tags=["alerts"])


@router.get("")
async def list_alerts(
    user: Annotated[dict, Depends(get_current_user)],
    patientId: str | None = Query(None),
):
    db = get_db()
    q: dict = {}
    if user["role"] == "guardian":
        q["guardianId"] = user["_id"]
        if patientId:
            try:
                q["patientId"] = ObjectId(patientId)
            except InvalidId:
                raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid patientId")
    else:
        q["patientId"] = user["_id"]

    cursor = db.alerts.find(q).sort("createdAt", -1).limit(200)
    return [serialize_alert(d) async for d in cursor]


@router.post("/{alert_id}/ack")
async def ack_alert(alert_id: str, user: Annotated[dict, Depends(get_current_user)]):
    if user["role"] != "guardian":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only guardians can acknowledge alerts")
    try:
        aid = ObjectId(alert_id)
    except InvalidId:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid alert id")
    db = get_db()
    alert = await db.alerts.find_one({"_id": aid})
    if not alert:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Alert not found")
    if alert.get("guardianId") != user["_id"]:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not allowed")
    await db.alerts.update_one({"_id": aid}, {"$set": {"acknowledged": True, "ackAt": now_utc()}})
    return {"message": "Acknowledged"}


@router.post("/ack-all")
async def ack_all(
    body: Annotated[dict, Body()],
    user: Annotated[dict, Depends(get_current_user)],
):
    if user["role"] != "guardian":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only guardians can bulk acknowledge")
    db = get_db()
    filt: dict = {"guardianId": user["_id"], "acknowledged": {"$ne": True}}
    pid = (body.get("patientId") or "").strip()
    if pid:
        try:
            filt["patientId"] = ObjectId(pid)
        except InvalidId:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid patientId")
    await db.alerts.update_many(filt, {"$set": {"acknowledged": True, "ackAt": now_utc()}})
    return {"message": "Acknowledged"}


@router.post("/sos")
async def sos(user: Annotated[dict, Depends(get_current_user)]):
    if user["role"] != "patient":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only patients can trigger SOS")
    db = get_db()
    pairing = await db.pairings.find_one({"patientId": user["_id"]})
    if not pairing:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "No guardian paired")

    gid = pairing["guardianId"]
    doc = {
        "type": "sos",
        "severity": "critical",
        "message": f"Emergency SOS from {user.get('fullName', 'patient')}",
        "patientId": user["_id"],
        "guardianId": gid,
        "acknowledged": False,
        "metadata": {},
        "createdAt": now_utc(),
    }
    res = await db.alerts.insert_one(doc)
    doc["_id"] = res.inserted_id
    await emit_alert_new(oid_str(gid), serialize_alert(doc))
    return {"message": "SOS sent to your guardian"}
