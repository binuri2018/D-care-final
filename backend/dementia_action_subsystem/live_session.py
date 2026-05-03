"""Per-client live pipeline: pose + LSTM sequence, risk deque, incident gate + save."""

from __future__ import annotations

import os
import threading
import time
import uuid
from collections import deque
from typing import Any

import numpy as np

from dementia_action_subsystem.alerts import send_caregiver_email_alert
from dementia_action_subsystem.config import (
    ACTION_INCIDENT_COOLDOWN_SECONDS,
    INCIDENT_POST_CAPTURE_SECONDS,
)
from dementia_action_subsystem.incident_gate import build_incident_trigger
from dementia_action_subsystem.incidents import save_action_incident
from dementia_action_subsystem.live_logs import (
    append_caregiver_alert_log,
    append_live_risk_event,
)
from dementia_action_subsystem.pose_engine import DementiaActionPoseEngine
from dementia_action_subsystem.pose_geometry import (
    choose_final_action,
    classify_pose_geometry,
    score_pose_quality,
)
from dementia_action_subsystem.risk_analysis import analyze_wandering_risk

MAX_HISTORY = 256
MAX_BUFFER_FRAMES = 90
SESSION_TTL_SEC = 30 * 60

_METRIC_KEYS = (
    "walking_duration",
    "direction_change_count",
    "pacing_score",
    "sit_stand_repetition_count",
    "long_lying_after_fall",
    "exit_zone_time",
    "lying_duration",
    "walking_density",
    "risk_signals",
)


def _sorted_history(history: deque) -> list[dict[str, Any]]:
    return sorted(history, key=lambda x: float(x["timestamp"]))


def _center_from_kpts(xy: np.ndarray) -> tuple[float, float]:
    if xy is None or xy.size == 0:
        return (0.5, 0.5)
    mask = (np.abs(xy[:, 0]) > 1e-5) | (np.abs(xy[:, 1]) > 1e-5)
    if not np.any(mask):
        return (0.5, 0.5)
    p = xy[mask]
    return (float(np.mean(p[:, 0])), float(np.mean(p[:, 1])))


def _motion_context(
    history: deque, now: float, current_center: tuple[float, float]
) -> dict[str, Any]:
    rows = _sorted_history(history)
    old = None
    for r in reversed(rows):
        if now - float(r["timestamp"]) >= 1.2:
            old = r
            break
    if old is None:
        return {}
    dx = abs(current_center[0] - float(old["center"][0]))
    if dx > 0.07:
        return {
            "is_walking": True,
            "confidence": min(0.95, 0.5 + dx * 2.5),
            "reason": "Horizontal motion over recent window.",
        }
    return {}


def _normalize_action_for_risk(label: str) -> str:
    if label == "Sit down":
        return "Sitting"
    if label == "Stand up":
        return "Standing"
    return label


def _metrics_subset(risk: dict[str, Any], extra: dict[str, Any] | None = None) -> dict[str, Any]:
    m = {k: risk[k] for k in _METRIC_KEYS if k in risk}
    if extra:
        for k, v in extra.items():
            if v is not None:
                m[k] = v
    return m


class DementiaActionLiveSession:
    def __init__(self, session_id: str) -> None:
        self.session_id = session_id
        self.engine = DementiaActionPoseEngine()
        self.history: deque = deque(maxlen=MAX_HISTORY)
        self.frame_buffer: deque = deque(maxlen=MAX_BUFFER_FRAMES)
        self.confirmation_state: dict[str, Any] = {}
        self.last_seen_ts: float = time.time()
        self._lock = threading.Lock()
        self._pending_incident: dict[str, Any] | None = None
        self._last_incident_ts: float | None = None

    def touch(self) -> None:
        self.last_seen_ts = time.time()

    def _flush_pending_incident(self, ts: float, out: dict[str, Any]) -> None:
        if self._pending_incident is None:
            return
        if ts < float(self._pending_incident["post_capture_until"]):
            return
        if not self.frame_buffer:
            return
        pend = self._pending_incident
        self._pending_incident = None
        tr = pend["trigger"]
        risk_snap = pend["risk"]
        pose_metrics = dict(pend["pose_metrics"] or {})
        if tr.get("confirmation_elapsed_s") is not None:
            pose_metrics["confirmation_elapsed_s"] = tr["confirmation_elapsed_s"]
        incident_row = save_action_incident(
            list(self.frame_buffer),
            self.frame_buffer[-1][1],
            str(tr["detected_action"]),
            float(tr["confidence"]),
            str(tr["reason"]),
            str(tr["behavior_type"]),
            str(pend.get("severity", "High")),
            _metrics_subset(risk_snap, pose_metrics),
            now=ts,
        )
        self._last_incident_ts = ts
        out["incident_saved"] = incident_row
        recipient = (
            os.environ.get("DEMENTIA_CAREGIVER_EMAIL")
            or os.environ.get("CAREGIVER_ALERT_EMAIL")
            or ""
        ).strip()
        if recipient:
            try:
                out["caregiver_email_dispatch"] = send_caregiver_email_alert(
                    incident_row,
                    recipient_email=recipient,
                )
            except Exception as e:
                out["caregiver_email_dispatch"] = {
                    "sent": False,
                    "status": "error",
                    "reason": str(e)[:300],
                }
        else:
            out["caregiver_email_dispatch"] = {
                "sent": False,
                "status": "disabled",
                "reason": "No recipient; browser alerts only.",
            }
        append_caregiver_alert_log(
            ts=ts,
            incident_id=str(incident_row.get("Id", "")),
            behavior=str(incident_row.get("BehaviorType", "")),
            severity=str(incident_row.get("Severity", "")),
            email_dispatch=out.get("caregiver_email_dispatch"),
        )

    def process_frame(
        self, frame_bgr: np.ndarray, *, use_exit_zone: bool, edge: float
    ) -> dict[str, Any]:
        with self._lock:
            return self._process_unlocked(frame_bgr, use_exit_zone, edge)

    def _process_unlocked(
        self, frame_bgr: np.ndarray, use_exit_zone: bool, edge: float
    ) -> dict[str, Any]:
        self.touch()
        ts = time.time()
        out: dict[str, Any] = {
            "session_id": self.session_id,
            "keypoints_normalized": None,
            "keypoint_confidences": None,
            "pose_visible_keypoints": None,
            "action": None,
            "confidence": None,
            "pose_quality": None,
            "geometry": None,
            "fusion_reason": "",
            "risk": None,
            "incident_saved": None,
            "incident_pending_until": None,
        }

        result = self.engine.process_frame(frame_bgr)
        result.pop("raw_result", None)
        kp = result.get("keypoints_normalized")
        if kp is None:
            out["risk"] = analyze_wandering_risk(
                self.history, ts, ts, use_exit_zone, edge
            )
            out["pose_visible_keypoints"] = 0
            append_live_risk_event(
                ts,
                str(out["risk"]["risk"]),
                "Unknown",
                str(out["risk"].get("reason", "")),
            )
            self.frame_buffer.append((ts, frame_bgr.copy()))
            self._flush_pending_incident(ts, out)
            if self._pending_incident is not None:
                out["incident_pending_until"] = float(
                    self._pending_incident["post_capture_until"]
                )
            return self._jsonify_payload(out, kp, result)

        xy = kp
        kconf = result.get("keypoint_confidences")
        if kconf is None:
            kconf = np.ones(17, dtype=np.float32) * 0.5
        pose_q = score_pose_quality(xy, kconf)
        geometry = classify_pose_geometry(xy, pose_q)
        lstm_action = result.get("action") or "Unknown"
        lstm_conf = float(result.get("confidence") or 0.0)
        center = _center_from_kpts(xy)
        motion = _motion_context(self.history, ts, center)
        action_final, conf_final, fusion_note = choose_final_action(
            lstm_action, lstm_conf, geometry, pose_q, motion
        )
        if not action_final or action_final == "Unknown":
            geom_map = {"Standing": "Standing", "Sitting": "Sitting", "Lying": "Lying Down"}
            gpost = geometry.get("posture", "")
            action_final = geom_map.get(gpost, "Standing")
            conf_final = float(max(conf_final, float(geometry.get("confidence", 0.35))))
            fusion_note = f"{fusion_note} | geometry label"

        action_risk = _normalize_action_for_risk(str(action_final))
        self.history.append(
            {
                "timestamp": ts,
                "center": center,
                "action": action_risk,
                "confidence": float(conf_final),
            }
        )

        window_start = min((float(e["timestamp"]) for e in self.history), default=ts)
        risk = analyze_wandering_risk(
            self.history, ts, window_start, use_exit_zone, edge
        )
        out["risk"] = risk
        append_live_risk_event(
            ts,
            str(risk["risk"]),
            str(action_final),
            str(risk.get("reason", "")),
        )

        self.frame_buffer.append((ts, frame_bgr.copy()))

        self._flush_pending_incident(ts, out)

        incident_row = out.get("incident_saved")

        trigger = build_incident_trigger(
            action_risk,
            float(conf_final),
            risk,
            pose_q,
            self.confirmation_state,
            ts,
        )

        if (
            incident_row is None
            and self._pending_incident is None
            and trigger is not None
            and (
                self._last_incident_ts is None
                or (ts - self._last_incident_ts) >= ACTION_INCIDENT_COOLDOWN_SECONDS
            )
        ):
            pose_metrics = {
                "pose_posture": geometry.get("posture"),
                "pose_visible_keypoints": int(pose_q.get("visible_count", 0)),
                "pose_reliable": bool(pose_q.get("reliable", False)),
                "pose_quality_score": round(float(pose_q.get("score", 0.0)), 3),
                "fusion_reason": (fusion_note or "")[:220],
            }
            self._pending_incident = {
                "trigger": trigger,
                "post_capture_until": ts + INCIDENT_POST_CAPTURE_SECONDS,
                "risk": dict(risk),
                "pose_metrics": pose_metrics,
                "severity": "High",
            }
            out["incident_pending_until"] = float(self._pending_incident["post_capture_until"])
        elif self._pending_incident is not None:
            out["incident_pending_until"] = float(
                self._pending_incident["post_capture_until"]
            )

        out["action"] = action_final
        out["confidence"] = conf_final
        out["pose_quality"] = pose_q
        out["geometry"] = geometry
        out["fusion_reason"] = fusion_note
        out["pose_visible_keypoints"] = int(pose_q.get("visible_count", 0))
        return self._jsonify_payload(out, xy, result)

    def _jsonify_payload(
        self,
        out: dict[str, Any],
        xy: np.ndarray | None,
        result: dict[str, Any],
    ) -> dict[str, Any]:
        if xy is not None:
            out["keypoints_normalized"] = xy.tolist()
        kc = result.get("keypoint_confidences")
        if kc is not None:
            out["keypoint_confidences"] = np.asarray(kc).tolist()
        pq = out.get("pose_quality")
        if pq is not None:
            out["pose_quality"] = {
                "reliable": bool(pq.get("reliable", False)),
                "score": float(pq.get("score", 0.0)),
                "visible_count": int(pq.get("visible_count", 0)),
            }
            if out.get("pose_visible_keypoints") is None:
                out["pose_visible_keypoints"] = out["pose_quality"]["visible_count"]
        geom = out.get("geometry")
        if geom is not None:
            out["geometry"] = {
                "posture": str(geom.get("posture", "")),
                "confidence": float(geom.get("confidence", 0.0)),
            }
        return out


_sessions: dict[str, DementiaActionLiveSession] = {}
_sessions_lock = threading.Lock()


def create_session() -> DementiaActionLiveSession:
    _evict_stale_sessions()
    sid = uuid.uuid4().hex
    sess = DementiaActionLiveSession(sid)
    with _sessions_lock:
        _sessions[sid] = sess
    return sess


def delete_session(session_id: str) -> bool:
    with _sessions_lock:
        return _sessions.pop(session_id, None) is not None


def get_session(session_id: str) -> DementiaActionLiveSession | None:
    _evict_stale_sessions()
    with _sessions_lock:
        s = _sessions.get(session_id)
        if s:
            s.touch()
        return s


def _evict_stale_sessions() -> None:
    now = time.time()
    with _sessions_lock:
        stale = [k for k, v in _sessions.items() if now - v.last_seen_ts > SESSION_TTL_SEC]
        for k in stale:
            _sessions.pop(k, None)


def live_session_count() -> int:
    """Active live pipelines (for integrated /health)."""
    _evict_stale_sessions()
    with _sessions_lock:
        return len(_sessions)
