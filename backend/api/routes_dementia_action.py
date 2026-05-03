"""API routes: dementia_action_subsystem (incidents + activity helpers)."""

from __future__ import annotations

import os
import re
import time
from pathlib import Path
from typing import Any

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from dementia_action_subsystem import config as dac_config
from dementia_action_subsystem.alerts import (
    build_caregiver_alert_message,
    send_caregiver_email_alert,
)
from dementia_action_subsystem.incidents import (
    delete_all_action_incidents,
    load_recent_action_incidents,
)
from dementia_action_subsystem.live_logs import (
    append_browser_alert_ack,
    list_caregiver_alert_log,
    list_live_risk_events,
)
from dementia_action_subsystem.live_session import (
    create_session,
    delete_session,
    get_session,
)
from dementia_action_subsystem.pose_engine import DementiaActionPoseEngine
from dementia_action_subsystem.risk_analysis import analyze_wandering_risk

router = APIRouter(tags=["dementia-action"])

_INCIDENT_ID_RE = re.compile(r"^inc_[a-f0-9]{12}$")


def _demo_incident_row_for_alert_preview() -> dict[str, Any]:
    """Sample row so caregivers can test notifications before any disk capture."""
    return {
        "Id": "demo_preview",
        "Time": "—",
        "Severity": "High",
        "BehaviorType": "Exit-zone risk (sample)",
        "Action": "Walking",
        "Confidence": "0.82",
        "Reason": "Sample alert — no incidents saved yet. Real alerts use live pose + LSTM + saved capture metadata.",
        "Metrics": {
            "walking_duration": 18.0,
            "exit_zone_time": 8.0,
            "direction_change_count": 4,
            "pacing_score": 40,
            "pose_posture": "Standing",
            "pose_visible_keypoints": 14,
            "pose_reliable": True,
            "pose_quality_score": 0.72,
            "fusion_reason": "LSTM accepted.",
        },
        "Label": "demo",
        "SnapshotPath": "",
        "ClipPath": "",
        "MetadataPath": "",
        "SnapshotUrl": "",
        "ClipUrl": "",
    }


class RiskSimulateRequest(BaseModel):
    """Synthetic history entries for demos / QA (matches analyze_wandering_risk shape)."""

    entries: list[dict[str, Any]] = Field(default_factory=list)
    now: float = 0.0
    use_exit_zone: bool = True
    edge: float = 0.15


@router.get("/dementia-action/health")
def dementia_action_health():
    recipient = (
        os.environ.get("DEMENTIA_CAREGIVER_EMAIL") or os.environ.get("CAREGIVER_ALERT_EMAIL") or ""
    ).strip()
    return {
        "subsystem": "dementia_action_subsystem",
        "incident_dir": dac_config.ACTION_INCIDENT_DIR,
        "model_root": str(dac_config.DEMENTIA_ACTION_MODEL_ROOT),
        "caregiver_email_configured": bool(recipient),
    }


@router.get("/dementia-action/incidents")
def list_incidents(limit: int = 50):
    rows = load_recent_action_incidents(limit=min(max(limit, 1), 200))
    return {"data": rows}


@router.delete("/dementia-action/incidents")
def clear_incidents():
    """Delete all stored incident files (snapshots, clips, metadata) for this subsystem."""
    out = delete_all_action_incidents()
    return {"ok": True, **out}


@router.get("/dementia-action/events")
def list_live_events():
    return {"data": list_live_risk_events()}


@router.get("/dementia-action/alerts")
def list_alerts():
    return {"data": list_caregiver_alert_log()}


class BrowserAlertAckBody(BaseModel):
    incident_id: str = ""
    behavior: str = ""
    severity: str = ""
    ok: bool = True


@router.post("/dementia-action/alerts/browser-ack")
def browser_alert_ack(body: BrowserAlertAckBody):
    if not body.incident_id or not _INCIDENT_ID_RE.match(body.incident_id):
        raise HTTPException(400, "invalid incident_id")
    row = append_browser_alert_ack(
        ts=time.time(),
        incident_id=body.incident_id,
        behavior=body.behavior,
        severity=body.severity,
        ok=body.ok,
    )
    return {"ok": True, "row": row}


@router.get("/dementia-action/incident-asset/{incident_id}/{kind}")
def incident_asset(incident_id: str, kind: str):
    if not _INCIDENT_ID_RE.match(incident_id):
        raise HTTPException(404, "not found")
    if kind not in ("snapshot", "clip"):
        raise HTTPException(404, "not found")
    root = Path(dac_config.ACTION_INCIDENT_DIR)
    ext = ".jpg" if kind == "snapshot" else ".mp4"
    path = (root / incident_id).with_suffix(ext)
    try:
        root_resolved = root.resolve()
        path = path.resolve()
        path.relative_to(root_resolved)
    except (OSError, ValueError):
        raise HTTPException(404, "not found") from None
    if not path.is_file():
        raise HTTPException(404, "not found")
    media = "image/jpeg" if kind == "snapshot" else "video/mp4"
    return FileResponse(path, media_type=media)


@router.post("/dementia-action/risk/simulate")
def simulate_risk(body: RiskSimulateRequest):
    """Run analyze_wandering_risk on a JSON history (no video upload required)."""
    from collections import deque

    dq: deque = deque()
    now = body.now if body.now else 0.0
    if not body.entries and body.now == 0.0:
        now = 1000.0
    for e in body.entries:
        dq.append(
            {
                "timestamp": float(e["timestamp"]),
                "center": tuple(e["center"]),
                "action": str(e["action"]),
                "confidence": float(e.get("confidence", 0.9)),
            }
        )
    if not dq and now:
        # empty history
        pass
    t0 = min((e["timestamp"] for e in dq), default=now)
    out = analyze_wandering_risk(dq, now, t0, body.use_exit_zone, body.edge)
    return out


@router.get("/dementia-action/alert-preview")
def alert_preview(incident_id: str | None = None):
    if incident_id:
        match = next(
            (r for r in load_recent_action_incidents(200) if r["Id"] == incident_id),
            None,
        )
        if not match:
            raise HTTPException(404, "incident not found")
        subject, body = build_caregiver_alert_message(match)
        return {"subject": subject, "body": body, "row": match, "demo": False}
    rows = load_recent_action_incidents(limit=1)
    if rows:
        row = rows[0]
        subject, body = build_caregiver_alert_message(row)
        return {"subject": subject, "body": body, "row": row, "demo": False}
    row = _demo_incident_row_for_alert_preview()
    subject, body = build_caregiver_alert_message(row)
    return {"subject": subject, "body": body, "row": row, "demo": True}


# Lazy singleton for optional frame analysis (loads TF/YOLO on first use)
_pose_engine: DementiaActionPoseEngine | None = None


def _get_engine() -> DementiaActionPoseEngine:
    global _pose_engine
    if _pose_engine is None:
        _pose_engine = DementiaActionPoseEngine()
    return _pose_engine


@router.post("/dementia-action/live/session")
def live_session_create():
    """Start a server-side live pipeline (own LSTM sequence buffer + risk history)."""
    sess = create_session()
    return {"session_id": sess.session_id}


@router.delete("/dementia-action/live/session/{session_id}")
def live_session_delete(session_id: str):
    deleted = delete_session(session_id)
    return {"ok": True, "deleted": deleted}


@router.post("/dementia-action/live/frame")
async def live_frame(
    session_id: str = Form(...),
    use_exit_zone: str = Form("true"),
    edge: float = Form(0.15),
    file: UploadFile = File(...),
):
    """
    Process one frame inside a live session: pose + LSTM, wandering risk, optional incident save.
    """
    import numpy as np

    sess = get_session(session_id)
    if sess is None:
        raise HTTPException(404, "unknown or expired session_id")
    use_ez = use_exit_zone.strip().lower() in ("true", "1", "yes", "on")
    edge_f = float(edge)
    if not (0.02 <= edge_f <= 0.45):
        raise HTTPException(400, "edge must be between 0.02 and 0.45")

    data = await file.read()
    if not data:
        raise HTTPException(400, "empty file")
    buf = np.frombuffer(data, dtype=np.uint8)
    import cv2

    frame = cv2.imdecode(buf, cv2.IMREAD_COLOR)
    if frame is None:
        raise HTTPException(400, "could not decode image")
    try:
        result = sess.process_frame(frame, use_exit_zone=use_ez, edge=edge_f)
    except FileNotFoundError as e:
        raise HTTPException(503, str(e)) from e
    return result


@router.post("/dementia-action/analyze-frame")
async def analyze_frame(file: UploadFile = File(...)):
    """
    Single-frame pose + action (requires yolov8n-pose.pt and action_lstm_model.keras
    under DEMENTIA_ACTION_MODEL_DIR).
    """
    import numpy as np

    data = await file.read()
    if not data:
        raise HTTPException(400, "empty file")
    buf = np.frombuffer(data, dtype=np.uint8)
    import cv2

    frame = cv2.imdecode(buf, cv2.IMREAD_COLOR)
    if frame is None:
        raise HTTPException(400, "could not decode image")
    try:
        result = _get_engine().process_frame(frame)
    except FileNotFoundError as e:
        raise HTTPException(503, str(e)) from e
    # drop non-serializable
    result.pop("raw_result", None)
    kp = result.get("keypoints_normalized")
    result["pose_visible_keypoints"] = 0
    if kp is not None:
        from dementia_action_subsystem.pose_geometry import (
            classify_pose_geometry,
            score_pose_quality,
        )

        kconf = result.get("keypoint_confidences")
        if kconf is None:
            kconf = np.ones(17, dtype=np.float32) * 0.5
        pose_q = score_pose_quality(kp, kconf)
        geometry = classify_pose_geometry(kp, pose_q)
        result["pose_quality"] = {
            "reliable": bool(pose_q["reliable"]),
            "score": float(pose_q["score"]),
            "visible_count": int(pose_q["visible_count"]),
        }
        result["geometry"] = {
            "posture": str(geometry["posture"]),
            "confidence": float(geometry["confidence"]),
        }
        result["pose_visible_keypoints"] = int(pose_q["visible_count"])
    if kp is not None:
        result["keypoints_normalized"] = kp.tolist()
    kc = result.get("keypoint_confidences")
    if kc is not None:
        result["keypoint_confidences"] = np.asarray(kc).tolist()
    return result
