"""Caregiver email alerts for dementia action incidents."""

from __future__ import annotations

import os
import smtplib
from email.message import EmailMessage
from typing import Any, Callable


def build_caregiver_alert_message(row: dict[str, Any]) -> tuple[str, str]:
    sev = row.get("Severity", "Alert")
    behavior = row.get("BehaviorType", "Incident")
    subject = f"Dementia Care Alert — {sev}: {behavior}"
    metrics = row.get("Metrics") or {}
    exit_s = metrics.get("exit_zone_time")
    exit_line = ""
    if exit_s is not None:
        es = float(exit_s)
        if es == int(es):
            exit_line = f"Exit-zone {int(es)}s"
        else:
            exit_line = f"Exit-zone {exit_s}s"

    pose_bits: list[str] = []
    if metrics.get("pose_posture"):
        pose_bits.append(f"Pose posture: {metrics['pose_posture']}")
    if metrics.get("pose_visible_keypoints") is not None:
        pose_bits.append(f"Keypoints visible: {metrics['pose_visible_keypoints']}/17")
    if "pose_reliable" in metrics and metrics["pose_reliable"] is not None:
        pose_bits.append(f"Pose reliable: {metrics['pose_reliable']}")
    if metrics.get("pose_quality_score") is not None:
        pose_bits.append(f"Pose quality score: {metrics['pose_quality_score']}")
    if metrics.get("fusion_reason"):
        pose_bits.append(f"Fusion: {metrics['fusion_reason']}")
    pose_block = "\n".join(pose_bits)

    body = (
        f"Severity: {sev}\n"
        f"Behavior: {behavior}\n"
        f"Action: {row.get('Action', '')}\n"
        f"Confidence: {row.get('Confidence', '')}\n"
        f"Reason: {row.get('Reason', '')}\n"
        f"{exit_line}"
    ).strip()
    if pose_block:
        body = f"{body}\n\n{pose_block}"
    return subject, body


def send_caregiver_email_alert(
    row: dict[str, Any],
    recipient_email: str | None = None,
    env: dict[str, str] | None = None,
    config_override: dict[str, Any] | None = None,
    smtp_factory: Callable[..., Any] | None = None,
) -> dict[str, Any]:
    env = env or os.environ
    smtp_factory = smtp_factory or smtplib.SMTP
    if not recipient_email:
        return {
            "sent": False,
            "status": "disabled",
            "reason": "No recipient configured; browser alert only.",
        }

    cfg = config_override or {}
    host = cfg.get("host") or env.get("SMTP_HOST")
    port = int(cfg.get("port") or env.get("SMTP_PORT", "587") or "587")
    from_email = cfg.get("from_email") or env.get("SMTP_FROM_EMAIL")
    username = cfg.get("username") or env.get("SMTP_USERNAME")
    password = cfg.get("password") or env.get("SMTP_PASSWORD")
    use_tls = str(cfg.get("use_tls", env.get("SMTP_USE_TLS", "false"))).lower() in (
        "1",
        "true",
        "yes",
    )

    if not config_override and (not host or not from_email):
        return {
            "sent": False,
            "status": "not_configured",
            "reason": "Missing SMTP host and sender email; configure SMTP_* env vars.",
        }

    subject, body = build_caregiver_alert_message(row)
    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = from_email or username or "alerts@localhost"
    msg["To"] = recipient_email
    msg.set_content(body)

    with smtp_factory(host or "localhost", port, timeout=10) as smtp:
        if use_tls:
            smtp.starttls()
        if username and password:
            smtp.login(username, password)
        smtp.send_message(msg)

    return {"sent": True, "status": "sent"}
