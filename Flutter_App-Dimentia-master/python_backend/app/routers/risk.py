from typing import Annotated

from bson import ObjectId
from bson.errors import InvalidId
from fastapi import APIRouter, Depends, HTTPException, status

from ..db import get_db
from ..deps import get_current_user

router = APIRouter(prefix="/risk", tags=["risk"])


@router.get("/current/{patient_id}")
async def current_risk(patient_id: str, user: Annotated[dict, Depends(get_current_user)]):
    try:
        pid = ObjectId(patient_id)
    except InvalidId:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid patient id")

    db = get_db()
    if user["role"] == "guardian":
        pairing = await db.pairings.find_one({"guardianId": user["_id"], "patientId": pid})
        if not pairing:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Not paired with this patient")
    elif user["_id"] != pid:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not allowed")

    doc = await db.risk_events.find_one({"patientId": pid}, sort=[("createdAt", -1)])
    if not doc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No risk assessments yet")
    return {
        "hybridRisk": doc.get("hybridRisk"),
        "weightedScore": doc.get("weightedScore"),
        "highStreakDays": doc.get("highStreakDays", 0),
        "createdAt": doc.get("createdAt").isoformat() if doc.get("createdAt") else None,
    }
