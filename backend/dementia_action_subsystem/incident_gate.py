"""Gate high-risk detections with pose quality and time-based confirmation."""

from __future__ import annotations

from typing import Any

from dementia_action_subsystem.config import confirmation_seconds_for_behavior


def build_incident_trigger(
    action: str,
    confidence: float,
    behavior: dict[str, Any],
    pose_quality: dict[str, Any],
    confirmation_state: dict[str, Any],
    now: float,
) -> dict[str, Any] | None:
    if behavior.get("risk") != "High":
        return None
    if not pose_quality.get("reliable", False):
        return None

    btype = behavior.get("behavior_type", "")
    reason = behavior.get("reason", "")
    required = confirmation_seconds_for_behavior(str(btype))

    key = f"high:{btype}"
    first_seen = confirmation_state.get(key)

    if first_seen is None:
        confirmation_state[key] = now
        return None

    if (now - float(first_seen)) < required:
        return None

    confirmation_state[key] = now
    return {
        "behavior_type": btype,
        "reason": f"{reason} (Confirmed)",
        "detected_action": action,
        "confidence": confidence,
    }
