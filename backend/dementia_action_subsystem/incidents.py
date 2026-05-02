"""Persist action incidents (snapshot, clip, JSON metadata)."""

from __future__ import annotations

import json
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import cv2
import numpy as np

from dementia_action_subsystem import config as _dac_config
from dementia_action_subsystem.config import ACTION_INCIDENT_LABEL, FALLBACK_INCIDENT_LABEL


def _ensure_dir() -> Path:
    p = Path(_dac_config.ACTION_INCIDENT_DIR)
    p.mkdir(parents=True, exist_ok=True)
    return p


def _display_time(ts: float) -> str:
    return datetime.fromtimestamp(ts, tz=timezone.utc).strftime("%Y-%m-%d %H:%M:%S")


def save_action_incident(
    frame_buffer: list[tuple[float, np.ndarray]],
    trigger_frame: np.ndarray,
    detected_action: str,
    confidence: float,
    reason: str,
    behavior_type: str,
    severity: str,
    metrics: dict[str, Any],
    now: float | None = None,
    *,
    incident_label: str | None = None,
) -> dict[str, Any]:
    """
    frame_buffer: list of (timestamp, bgr uint8 image)
    """
    now = now if now is not None else datetime.now(tz=timezone.utc).timestamp()
    root = _ensure_dir()
    incident_id = f"inc_{uuid.uuid4().hex[:12]}"
    base = root / incident_id
    snapshot_path = base.with_suffix(".jpg")
    clip_path = base.with_suffix(".mp4")
    metadata_path = base.with_suffix(".json")

    cv2.imwrite(str(snapshot_path), trigger_frame)

    if frame_buffer:
        h, w = frame_buffer[0][1].shape[:2]
        dt = 0.1
        if len(frame_buffer) > 1:
            dt = max(0.03, float(frame_buffer[1][0] - frame_buffer[0][0]))
        fps = min(30.0, 1.0 / dt)
        fourcc = cv2.VideoWriter_fourcc(*"mp4v")
        writer = cv2.VideoWriter(str(clip_path), fourcc, fps, (w, h))
        for _, frame in frame_buffer:
            if frame.shape[0] != h or frame.shape[1] != w:
                frame = cv2.resize(frame, (w, h))
            writer.write(frame)
        writer.release()
    else:
        clip_path.write_bytes(b"")

    label = incident_label or ACTION_INCIDENT_LABEL
    payload = {
        "id": incident_id,
        "timestamp": now,
        "display_time": _display_time(now),
        "label": label,
        "detected_action": detected_action,
        "confidence": confidence,
        "reason": reason,
        "behavior_type": behavior_type,
        "severity": severity,
        "metrics": metrics,
        "snapshot_path": str(snapshot_path.resolve()),
        "clip_path": str(clip_path.resolve()),
    }
    metadata_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")

    row = _metadata_to_row(payload)
    row["MetadataPath"] = str(metadata_path.resolve())
    return row


def save_fallback_incident(
    frame_buffer: list[tuple[float, np.ndarray]],
    fall_frame: np.ndarray,
    detected_action: str,
    confidence: float,
    reason: str,
    now: float | None = None,
) -> dict[str, Any]:
    return save_action_incident(
        frame_buffer,
        fall_frame,
        detected_action,
        confidence,
        reason,
        "Fall Down",
        "High",
        {},
        now=now,
        incident_label=FALLBACK_INCIDENT_LABEL,
    )


def _metadata_to_row(meta: dict[str, Any]) -> dict[str, Any]:
    label = meta.get("label", ACTION_INCIDENT_LABEL)
    snap = meta.get("snapshot_path", "")
    meta_path = ""
    if snap:
        meta_path = str(Path(snap).with_suffix(".json"))
    return {
        "Id": meta.get("id", "unknown"),
        "Time": meta.get("display_time", ""),
        "Severity": meta.get("severity", "High"),
        "BehaviorType": meta.get("behavior_type", meta.get("detected_action", "")),
        "Action": meta.get("detected_action", ""),
        "Confidence": f"{float(meta.get('confidence', 0.0)):.2f}",
        "Reason": meta.get("reason", ""),
        "Metrics": meta.get("metrics") or {},
        "Label": label,
        "SnapshotPath": snap,
        "ClipPath": meta.get("clip_path", ""),
        "MetadataPath": meta_path,
    }


def _row_from_legacy(meta: dict[str, Any]) -> dict[str, Any]:
    return {
        "Id": meta.get("id", "legacy"),
        "Time": meta.get("display_time", ""),
        "Severity": "High",
        "BehaviorType": meta.get("detected_action", "Fall Down"),
        "Action": meta.get("detected_action", ""),
        "Confidence": str(meta.get("confidence", "")),
        "Reason": meta.get("reason", ""),
        "Metrics": {},
        "Label": meta.get("label", FALLBACK_INCIDENT_LABEL),
        "SnapshotPath": meta.get("snapshot_path", ""),
        "ClipPath": meta.get("clip_path", ""),
        "MetadataPath": "",
    }


def load_recent_action_incidents(limit: int = 50) -> list[dict[str, Any]]:
    root = Path(_dac_config.ACTION_INCIDENT_DIR)
    if not root.is_dir():
        return []
    metas: list[tuple[float, dict[str, Any]]] = []
    for path in root.glob("*.json"):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            if "label" in data and data["label"] == FALLBACK_INCIDENT_LABEL and (
                "behavior_type" not in data
            ):
                row = _row_from_legacy(data)
            else:
                row = _metadata_to_row(data)
                row["MetadataPath"] = str(path.resolve())
        except (json.JSONDecodeError, OSError):
            continue
        ts = float(data.get("timestamp", 0))
        metas.append((ts, row))
    metas.sort(key=lambda x: x[0], reverse=True)
    return [r for _, r in metas[:limit]]
