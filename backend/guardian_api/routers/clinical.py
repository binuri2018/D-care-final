import logging
from pathlib import Path
from typing import Annotated

from bson import ObjectId
from bson.errors import InvalidId
from fastapi import APIRouter, Body, Depends, HTTPException, status
from pymongo.errors import DuplicateKeyError, PyMongoError

from ..config import Settings, settings_paths
from ..db import get_db
from ..deps import get_current_user, get_settings
from ..services.inference import clinical_payload_from_form, run_clinical_subprocess
from ..services.risk import hybrid_from_scores, mapped_from_probability
from ..util import now_utc

logger = logging.getLogger(__name__)

router = APIRouter(tags=["clinical"])

BACKEND_ROOT = Path(__file__).resolve().parents[1]


async def _resolve_patient_id(user: dict, body: dict) -> ObjectId:
    if user["role"] == "patient":
        return user["_id"]
    pid = (body.get("patientId") or "").strip()
    if not pid:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "patientId required for guardian submissions")
    try:
        oid = ObjectId(pid)
    except InvalidId:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid patientId")
    db = get_db()
    pairing = await db.pairings.find_one({"guardianId": user["_id"], "patientId": oid})
    if not pairing:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not paired with this patient")
    return oid


@router.post("/clinical-form")
async def submit_clinical(
    body: Annotated[dict, Body()],
    user: Annotated[dict, Depends(get_current_user)],
    settings: Annotated[Settings, Depends(get_settings)],
):
    required = ["age", "bmi", "educationLevel", "mmse", "functionalAssessment", "memoryComplaints", "forgetfulness"]
    for k in required:
        if k not in body:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Missing field: {k}")

    patient_oid = await _resolve_patient_id(user, body)
    try:
        payload = clinical_payload_from_form(body)
    except (KeyError, TypeError, ValueError) as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Invalid clinical field: {e}") from e
    _, clin_path = settings_paths(settings, BACKEND_ROOT)
    if not clin_path.is_file():
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            f"Clinical model not found at {clin_path}",
        )

    try:
        raw = await run_clinical_subprocess(settings.python_bin, clin_path, payload)
    except Exception as e:
        # Common causes: missing xgboost/joblib in PYTHON_BIN env, bad model path, model load/predict error.
        logger.exception("Clinical inference subprocess failed")
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(e)) from e

    if "error" in raw:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, raw.get("error", "inference error"))

    prob = float(raw.get("probability", 0))
    mapped = mapped_from_probability(prob)

    db = get_db()
    sub = {
        "patientId": patient_oid,
        "submittedBy": user["_id"],
        "age": body["age"],
        "bmi": body["bmi"],
        "educationLevel": body["educationLevel"],
        "mmse": body["mmse"],
        "functionalAssessment": body["functionalAssessment"],
        "memoryComplaints": body["memoryComplaints"],
        "forgetfulness": body["forgetfulness"],
        "modelProbability": prob,
        "mappedRisk": mapped,
        "createdAt": now_utc(),
    }
    try:
        await db.clinical_submissions.insert_one(sub)

        latest_mri = await db.mri_submissions.find_one({"patientId": patient_oid}, sort=[("createdAt", -1)])
        mri_mapped = latest_mri.get("mappedRisk") if latest_mri else None

        hybrid, wscore = hybrid_from_scores(
            prob,
            mapped,
            mri_mapped,
            settings.risk_clinical_weight,
            settings.risk_mri_weight,
        )

        risk_doc = {
            "patientId": patient_oid,
            "hybridRisk": hybrid,
            "weightedScore": wscore,
            "highStreakDays": 0,
            "clinicalProbability": prob,
            "mriMapped": mri_mapped,
            "createdAt": now_utc(),
        }
        await db.risk_events.insert_one(risk_doc)
    except DuplicateKeyError as e:
        raise HTTPException(status.HTTP_409_CONFLICT, str(e)) from e
    except PyMongoError as e:
        logger.exception("Clinical form DB write failed")
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, f"Database error: {e}") from e

    return {
        "clinical": {"modelProbability": prob, "mappedRisk": mapped},
        "riskEvent": {"hybridRisk": hybrid, "weightedScore": wscore},
    }


@router.get("/clinical-form/trends/{patient_id}")
async def trends(patient_id: str, user: Annotated[dict, Depends(get_current_user)]):
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

    cursor = db.clinical_submissions.find({"patientId": pid}).sort("createdAt", 1).limit(500)
    out = []
    async for d in cursor:
        out.append(
            {
                "modelProbability": d.get("modelProbability", 0),
                "mappedRisk": d.get("mappedRisk"),
                "createdAt": d.get("createdAt").isoformat() if d.get("createdAt") else None,
            }
        )
    return out
