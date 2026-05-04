import tempfile
from pathlib import Path
from typing import Annotated

from bson import ObjectId
from bson.errors import InvalidId
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status

from ..config import Settings, settings_paths
from ..db import get_db
from ..deps import get_current_user, get_settings
from ..services.inference import run_mri_subprocess
from ..services.risk import hybrid_from_scores, mapped_from_label
from ..util import now_utc

router = APIRouter(tags=["mri"])

BACKEND_ROOT = Path(__file__).resolve().parents[1]


async def _patient_for_mri(user: dict, patient_id_form: str | None) -> ObjectId:
    if user["role"] == "patient":
        return user["_id"]
    pid = (patient_id_form or "").strip()
    if not pid:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "patientId required for guardian MRI upload")
    try:
        oid = ObjectId(pid)
    except InvalidId:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid patientId")
    db = get_db()
    pairing = await db.pairings.find_one({"guardianId": user["_id"], "patientId": oid})
    if not pairing:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not paired with this patient")
    return oid


@router.post("/mri/upload")
async def mri_upload(
    user: Annotated[dict, Depends(get_current_user)],
    settings: Annotated[Settings, Depends(get_settings)],
    mri: UploadFile = File(...),
    patientId: str | None = Form(None),
):
    patient_oid = await _patient_for_mri(user, patientId)
    mri_path, _ = settings_paths(settings, BACKEND_ROOT)
    if not mri_path.is_file() and not mri_path.is_dir():
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            f"MRI model not found at {mri_path}",
        )

    suffix = Path(mri.filename or "scan.png").suffix or ".png"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        content = await mri.read()
        tmp.write(content)
        tmp_path = Path(tmp.name)

    try:
        raw = await run_mri_subprocess(settings.python_bin, mri_path, tmp_path)
    except Exception as e:
        tmp_path.unlink(missing_ok=True)
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, str(e)) from e
    finally:
        tmp_path.unlink(missing_ok=True)

    if "error" in raw:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, raw.get("error", "inference error"))

    mapped = raw.get("mappedRisk") or mapped_from_label(raw.get("classLabel"))
    conf = float(raw.get("confidence", 0))

    db = get_db()
    doc = {
        "patientId": patient_oid,
        "submittedBy": user["_id"],
        "classId": raw.get("classId"),
        "classLabel": raw.get("classLabel"),
        "confidence": conf,
        "mappedRisk": mapped,
        "createdAt": now_utc(),
    }
    await db.mri_submissions.insert_one(doc)

    latest_clin = await db.clinical_submissions.find_one({"patientId": patient_oid}, sort=[("createdAt", -1)])
    clin_prob = latest_clin.get("modelProbability") if latest_clin else None
    clin_mapped = latest_clin.get("mappedRisk") if latest_clin else None

    hybrid, wscore = hybrid_from_scores(
        float(clin_prob) if clin_prob is not None else None,
        clin_mapped,
        mapped,
        settings.risk_clinical_weight,
        settings.risk_mri_weight,
    )
    await db.risk_events.insert_one(
        {
            "patientId": patient_oid,
            "hybridRisk": hybrid,
            "weightedScore": wscore,
            "highStreakDays": 0,
            "clinicalProbability": clin_prob,
            "mriMapped": mapped,
            "createdAt": now_utc(),
        }
    )

    return {
        "mri": {
            "classId": raw.get("classId"),
            "classLabel": raw.get("classLabel"),
            "confidence": conf,
            "mappedRisk": mapped,
        },
        "riskEvent": {"hybridRisk": hybrid, "weightedScore": wscore},
    }
