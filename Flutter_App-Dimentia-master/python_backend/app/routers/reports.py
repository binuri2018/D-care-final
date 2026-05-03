from pathlib import Path
from typing import Annotated

from bson import ObjectId
from bson.errors import InvalidId
from fastapi import APIRouter, Body, Depends, HTTPException, status
from fastapi.responses import FileResponse

from ..config import Settings
from ..db import get_db
from ..deps import get_current_user, get_settings
from ..services.reports_pdf import build_patient_report_pdf
from ..socket_manager import emit_alert_new
from ..util import now_utc, serialize_alert

router = APIRouter(prefix="/reports", tags=["reports"])

BACKEND_ROOT = Path(__file__).resolve().parents[2]


def _reports_dir(settings: Settings) -> Path:
    p = (settings.reports_dir or "data/reports").strip()
    path = Path(p)
    if path.is_absolute():
        return path
    return (BACKEND_ROOT / path).resolve()


@router.post("/generate")
async def generate_report(
    body: Annotated[dict, Body()],
    user: Annotated[dict, Depends(get_current_user)],
    settings: Annotated[Settings, Depends(get_settings)],
):
    if user["role"] != "guardian":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only guardians can generate reports")
    pid = (body.get("patientId") or "").strip()
    if not pid:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "patientId required")
    try:
        poid = ObjectId(pid)
    except InvalidId:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid patientId")

    db = get_db()
    pairing = await db.pairings.find_one({"guardianId": user["_id"], "patientId": poid})
    if not pairing:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not paired with this patient")

    patient = await db.users.find_one({"_id": poid})
    pname = patient.get("fullName", "Patient") if patient else "Patient"
    risk = await db.risk_events.find_one({"patientId": poid}, sort=[("createdAt", -1)])
    hybrid = risk.get("hybridRisk") if risk else None
    hb = await db.heartbeats.find_one({"patientId": poid}, sort=[("createdAt", -1)])
    hb_serialized = None
    if hb:
        hb_serialized = {
            "latitude": hb.get("latitude"),
            "longitude": hb.get("longitude"),
            "createdAt": hb.get("createdAt").isoformat() if hb.get("createdAt") else None,
        }

    rid = ObjectId()
    rdir = _reports_dir(settings)
    fname = f"{rid}.pdf"
    fpath = rdir / fname
    build_patient_report_pdf(patient_name=pname, hybrid_risk=hybrid, last_hb=hb_serialized, out_path=fpath)

    meta = {
        "_id": rid,
        "patientId": poid,
        "guardianId": user["_id"],
        "filename": fname,
        "triggerSource": body.get("triggerSource", "api"),
        "createdAt": now_utc(),
    }
    await db.reports.insert_one(meta)

    alert = {
        "type": "report",
        "severity": "info",
        "message": f"New report available for {pname}",
        "patientId": poid,
        "guardianId": user["_id"],
        "acknowledged": False,
        "metadata": {"reportId": str(rid)},
        "createdAt": now_utc(),
    }
    ares = await db.alerts.insert_one(alert)
    alert["_id"] = ares.inserted_id
    await emit_alert_new(str(user["_id"]), serialize_alert(alert))

    return {"downloadUrl": f"/api/reports/{rid}/download"}


@router.get("/{report_id}/download")
async def download_report(
    report_id: str,
    user: Annotated[dict, Depends(get_current_user)],
    settings: Annotated[Settings, Depends(get_settings)],
):
    try:
        rid = ObjectId(report_id)
    except InvalidId:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid report id")
    db = get_db()
    doc = await db.reports.find_one({"_id": rid})
    if not doc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Report not found")
    if user["role"] == "guardian" and doc.get("guardianId") != user["_id"]:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not allowed")
    if user["role"] == "patient" and doc.get("patientId") != user["_id"]:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not allowed")

    fpath = _reports_dir(settings) / doc.get("filename", "")
    if not fpath.is_file():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "File missing")
    return FileResponse(fpath, media_type="application/pdf", filename=f"dementia_report_{rid}.pdf")
