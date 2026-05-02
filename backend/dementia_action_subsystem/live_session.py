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
from dementia_action_subsystem.incident_gate import build_incident_trigger
from dementia_action_subsystem.incidents import save_action_incident
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

    def touch(self) -> None:
        self.last_seen_ts = time.time()

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
        }

        result = self.engine.process_frame(frame_bgr)
        result.pop("raw_result", None)
        kp = result.get("keypoints_normalized")
        if kp is None:
            out["risk"] = analyze_wandering_risk(
                self.history, ts, ts, use_exit_zone, edge
            )
            out["pose_visible_keypoints"] = 0
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

        trigger = build_incident_trigger(
            action_risk,
            float(conf_final),
            risk,
            pose_q,
            self.confirmation_state,
            ts,
        )

        self.frame_buffer.append((ts, frame_bgr.copy()))

        incident_row = None
        if trigger is not None:
            pose_metrics = {
                "pose_posture": geometry.get("posture"),
                "pose_visible_keypoints": int(pose_q.get("visible_count", 0)),
                "pose_reliable": bool(pose_q.get("reliable", False)),
                "pose_quality_score": round(float(pose_q.get("score", 0.0)), 3),
                "fusion_reason": (fusion_note or "")[:220],
            }
            incident_row = save_action_incident(
                list(self.frame_buffer),
                self.frame_buffer[-1][1],
                str(trigger["detected_action"]),
                float(trigger["confidence"]),
                str(trigger["reason"]),
                str(trigger["behavior_type"]),
                "High",
                _metrics_subset(risk, pose_metrics),
                now=ts,
            )
        if incident_row is not None:
            out["incident_saved"] = incident_row
            recipient = (os.environ.get("DEMENTIA_CAREGIVER_EMAIL") or os.environ.get("CAREGIVER_ALERT_EMAIL") or "").strip()
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
