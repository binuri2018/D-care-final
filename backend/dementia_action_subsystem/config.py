"""Paths and constants for dementia_action_subsystem."""

from __future__ import annotations

import os
from pathlib import Path

_SUBSYS_ROOT = Path(__file__).resolve().parent
BACKEND_ROOT = _SUBSYS_ROOT.parent

# Labels stored in incident metadata
ACTION_INCIDENT_LABEL = "dementia_action_v1"
FALLBACK_INCIDENT_LABEL = "dementia_action_fallback_v1"

# Default directory for incident clips & metadata (override via env)
_default_incident_dir = BACKEND_ROOT / "storage" / "dementia_action_incidents"
ACTION_INCIDENT_DIR = os.environ.get(
    "DEMENTIA_ACTION_INCIDENT_DIR", str(_default_incident_dir)
)

# Bundled / env-configured weights (YOLO .pt + Keras LSTM) under backend/assets/
DEMENTIA_ACTION_MODEL_ROOT = Path(
    os.environ.get(
        "DEMENTIA_ACTION_MODEL_DIR",
        str(BACKEND_ROOT / "assets" / "dementia_action"),
    )
)
LSTM_MODEL_FILENAME = os.environ.get(
    "DEMENTIA_ACTION_LSTM_MODEL", "action_lstm_model.keras"
)
YOLO_POSE_WEIGHTS = os.environ.get("DEMENTIA_ACTION_YOLO_POSE", "yolov8n-pose.pt")

SEQUENCE_LENGTH = int(os.environ.get("DEMENTIA_ACTION_SEQUENCE_LEN", "30"))
ACTION_CONFIDENCE_THRESHOLD = float(
    os.environ.get("DEMENTIA_ACTION_CONF_THRESHOLD", "0.6")
)

MIN_PACING_WALKING_DENSITY = 0.52

RISK_THRESHOLDS = {
    "pacing_direction_changes": 5,
    "pacing_window_seconds": 24,
    "exit_zone_edge": 0.15,
    "exit_zone_seconds": 6,
    "restlessness_reps_high": 6,
    "restlessness_min_dwell_sec": 1.0,
    "sustained_lying_seconds": 12,
    "long_lying_after_fall_seconds": 8,
    "fall_transition_window_sec": 2.0,
    "lying_vertical_drop": 0.18,
}

HIGH_RISK_CONFIRMATION_SEC = 5.0
RESTLESSNESS_CONFIRMATION_SEC = 20.0
