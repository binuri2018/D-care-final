"""
Compatibility shim for tests (`import dementia_action_subsystem.app_compat as app`).

Prefer importing concrete modules in application code:
  • dementia_action_subsystem.incidents
  • dementia_action_subsystem.risk_analysis
  • …
"""

from dementia_action_subsystem.alerts import (
    build_caregiver_alert_message,
    send_caregiver_email_alert,
)
from dementia_action_subsystem.config import (
    ACTION_INCIDENT_DIR,
    ACTION_INCIDENT_LABEL,
    FALLBACK_INCIDENT_LABEL,
    MIN_PACING_WALKING_DENSITY,
    RISK_THRESHOLDS,
)
from dementia_action_subsystem.incident_gate import build_incident_trigger
from dementia_action_subsystem.incidents import (
    load_recent_action_incidents,
    save_action_incident,
    save_fallback_incident,
)
from dementia_action_subsystem.pose_geometry import (
    choose_final_action,
    classify_pose_geometry,
    score_pose_quality,
)
from dementia_action_subsystem.risk_analysis import analyze_wandering_risk
from dementia_action_subsystem.video_report import (
    build_video_activity_report,
    make_video_activity_sample,
)

__all__ = [
    "ACTION_INCIDENT_DIR",
    "ACTION_INCIDENT_LABEL",
    "FALLBACK_INCIDENT_LABEL",
    "MIN_PACING_WALKING_DENSITY",
    "RISK_THRESHOLDS",
    "analyze_wandering_risk",
    "build_caregiver_alert_message",
    "build_incident_trigger",
    "build_video_activity_report",
    "choose_final_action",
    "classify_pose_geometry",
    "load_recent_action_incidents",
    "make_video_activity_sample",
    "save_action_incident",
    "save_fallback_incident",
    "score_pose_quality",
    "send_caregiver_email_alert",
]
