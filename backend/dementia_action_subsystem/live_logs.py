"""Process-wide live risk event log and caregiver alert log for dementia action monitoring."""

from __future__ import annotations

import threading
from collections import deque
from datetime import datetime, timezone
from typing import Any

from dementia_action_subsystem.config import (
    LIVE_EVENT_DEDUP_SECONDS,
    MAX_CAREGIVER_ALERT_LOG,
    MAX_LIVE_RISK_EVENTS,
)

_events_lock = threading.Lock()
_live_risk_events: deque[dict[str, Any]] = deque(maxlen=MAX_LIVE_RISK_EVENTS)
_last_event_dedup_at: dict[str, float] = {}

_alerts_lock = threading.Lock()
_caregiver_alert_log: deque[dict[str, Any]] = deque(maxlen=MAX_CAREGIVER_ALERT_LOG)


def _display_time(ts: float) -> str:
    return datetime.fromtimestamp(ts, tz=timezone.utc).strftime("%Y-%m-%d %H:%M:%S")


def append_live_risk_event(ts: float, risk: str, action: str, reason: str) -> None:
    if risk not in ("Medium", "High"):
        return
    key = f"{risk}:{action}:{reason[:120]}"
    with _events_lock:
        last = _last_event_dedup_at.get(key, 0.0)
        if ts - last < LIVE_EVENT_DEDUP_SECONDS:
            return
        _last_event_dedup_at[key] = ts
        if len(_last_event_dedup_at) > 400:
            cutoff = ts - LIVE_EVENT_DEDUP_SECONDS * 3
            stale = [k for k, t in _last_event_dedup_at.items() if t < cutoff]
            for k in stale[:220]:
                _last_event_dedup_at.pop(k, None)
        _live_risk_events.appendleft(
            {
                "time": _display_time(ts),
                "timestamp": ts,
                "risk": risk,
                "action": action,
                "reason": reason,
            }
        )


def list_live_risk_events() -> list[dict[str, Any]]:
    with _events_lock:
        return list(_live_risk_events)


def reset_live_logs_for_tests() -> None:
    """Test helper — clear dedup state and deques."""
    with _events_lock:
        _live_risk_events.clear()
        _last_event_dedup_at.clear()
    with _alerts_lock:
        _caregiver_alert_log.clear()


def append_caregiver_alert_log(
    *,
    ts: float,
    incident_id: str,
    behavior: str,
    severity: str,
    email_dispatch: dict[str, Any] | None,
) -> dict[str, Any]:
    mail = email_dispatch or {}
    if mail.get("sent"):
        status_message = "Email sent"
    elif mail.get("status") == "disabled":
        status_message = "Email not configured — use browser alerts in the console"
    elif mail.get("status") == "not_configured":
        status_message = "Email: SMTP not configured"
    else:
        status_message = f"Email: {mail.get('reason', mail.get('status', 'unknown'))}"
    row = {
        "time": _display_time(ts),
        "timestamp": ts,
        "incident_id": incident_id,
        "behavior": behavior,
        "severity": severity,
        "status_message": status_message,
    }
    with _alerts_lock:
        _caregiver_alert_log.appendleft(row)
    return row


def append_browser_alert_ack(
    *,
    ts: float,
    incident_id: str,
    behavior: str,
    severity: str,
    ok: bool,
) -> dict[str, Any]:
    msg = "Browser notification shown" if ok else "Browser notification blocked or failed"
    row = {
        "time": _display_time(ts),
        "timestamp": ts,
        "incident_id": incident_id,
        "behavior": behavior or "—",
        "severity": severity or "—",
        "status_message": msg,
    }
    with _alerts_lock:
        _caregiver_alert_log.appendleft(row)
    return row


def list_caregiver_alert_log() -> list[dict[str, Any]]:
    with _alerts_lock:
        return list(_caregiver_alert_log)
