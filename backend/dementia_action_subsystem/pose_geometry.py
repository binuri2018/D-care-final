"""Heuristic pose quality and geometry vs LSTM action fusion."""

from __future__ import annotations

from typing import Any

import numpy as np

KEYPOINT_MIN_VISIBLE = 8
FULL_BODY_INDICES = {5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16}


def score_pose_quality(
    kpts: np.ndarray,
    confidences: np.ndarray | None = None,
    bbox: tuple[float, float, float, float] | None = None,
    box_confidence: float = 0.0,
) -> dict[str, Any]:
    confidences = confidences if confidences is not None else np.zeros(17)
    visible = int(np.sum(confidences > 0.25))
    full_body_hits = 0
    for i in FULL_BODY_INDICES:
        if confidences[i] <= 0.25:
            continue
        if np.allclose(kpts[i], 0.0):
            continue
        full_body_hits += 1
    score = float(np.mean(confidences)) if len(confidences) else 0.0
    if bbox and box_confidence:
        score = max(score, box_confidence * 0.9)
    reliable = full_body_hits >= KEYPOINT_MIN_VISIBLE and visible >= 10
    return {
        "reliable": reliable,
        "score": float(min(1.0, score)),
        "visible_count": visible,
    }


def classify_pose_geometry(
    kpts: np.ndarray, quality: dict[str, Any]
) -> dict[str, Any]:
    if quality.get("score", 0) < 0.35:
        return {"posture": "Uncertain posture", "confidence": quality.get("score", 0.0)}

    shoulder_y = float((kpts[5, 1] + kpts[6, 1]) / 2)
    hip_y = float((kpts[11, 1] + kpts[12, 1]) / 2)
    ankle_y = float((kpts[15, 1] + kpts[16, 1]) / 2)

    vert_span = max(abs(ankle_y - shoulder_y), 1e-6)
    hip_ratio = (hip_y - shoulder_y) / vert_span

    # Horizontal pose in image — typical lying / reclining in frame
    if vert_span < 0.20:
        return {"posture": "Lying", "confidence": 0.9}

    # Lying: hips and shoulders roughly level while still some vertical extent
    if abs(hip_y - shoulder_y) < vert_span * 0.22:
        return {"posture": "Lying", "confidence": 0.9}

    if hip_ratio > 0.48:
        return {"posture": "Sitting", "confidence": 0.85}

    if hip_ratio >= 0.22 and ankle_y > hip_y + vert_span * 0.10:
        return {"posture": "Standing", "confidence": 0.9}

    return {"posture": "Sitting", "confidence": 0.85}


def choose_final_action(
    lstm_action: str,
    lstm_conf: float,
    geometry: dict[str, Any],
    pose_quality: dict[str, Any],
    motion_context: dict[str, Any] | None = None,
) -> tuple[str, float, str]:
    motion_context = motion_context or {}
    geo_post = geometry.get("posture", "")
    geo_conf = float(geometry.get("confidence", 0))

    if lstm_action == "Fall Down":
        if geo_post in ("Lying", "Uncertain posture"):
            return lstm_action, lstm_conf, "LSTM fall with compatible geometry."
        return "Standing", geo_conf, "Geometry overrides false fall."

    if geo_post == "Standing" and lstm_action == "Lying Down":
        return "Standing", geo_conf, "Geometry overrides LSTM lying."

    if motion_context.get("is_walking"):
        return (
            "Walking",
            max(float(motion_context.get("confidence", 0)), lstm_conf * 0.9),
            motion_context.get("reason", "Motion indicates walking."),
        )

    return lstm_action, lstm_conf, "LSTM accepted."
