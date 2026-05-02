"""
Dementia action pose pipeline: YOLOv8-pose + LSTM (optional, lazy-loaded).
Runs on server-side frames only — no webcam loop at import time.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any

import numpy as np

from dementia_action_subsystem.config import (
    ACTION_CONFIDENCE_THRESHOLD,
    DEMENTIA_ACTION_MODEL_ROOT,
    LSTM_MODEL_FILENAME,
    SEQUENCE_LENGTH,
    YOLO_POSE_WEIGHTS,
)

_LOG = logging.getLogger(__name__)

ACTION_LABELS = [
    "Fall Down",
    "Lying Down",
    "Sit down",
    "Sitting",
    "Stand up",
    "Standing",
    "Walking",
]


@dataclass
class DementiaActionPoseEngine:
    """Lazy-loaded inference engine for single frames / rolling sequences."""

    _pose: Any = None
    _lstm: Any = None
    _sequence: list[np.ndarray] = field(default_factory=list)

    def _load_pose(self) -> Any:
        if self._pose is None:
            from ultralytics import YOLO

            w = DEMENTIA_ACTION_MODEL_ROOT / YOLO_POSE_WEIGHTS
            if not w.is_file():
                w = YOLO_POSE_WEIGHTS  # download / cwd
            self._pose = YOLO(str(w))
        return self._pose

    def _load_lstm(self) -> Any:
        if self._lstm is None:
            from tensorflow.keras.models import load_model

            p = DEMENTIA_ACTION_MODEL_ROOT / LSTM_MODEL_FILENAME
            if not p.is_file():
                raise FileNotFoundError(
                    f"LSTM weights not found at {p}. Place {LSTM_MODEL_FILENAME} under {DEMENTIA_ACTION_MODEL_ROOT}."
                )
            self._lstm = load_model(str(p))
        return self._lstm

    def reset_sequence(self) -> None:
        self._sequence.clear()

    def process_frame(
        self, frame_bgr: np.ndarray, *, img_w: int = 640, img_h: int = 480
    ) -> dict[str, Any]:
        """Run pose on BGR image; update LSTM sequence; return keypoints + action if ready."""
        resized = frame_bgr
        if frame_bgr.shape[1] != img_w or frame_bgr.shape[0] != img_h:
            import cv2

            resized = cv2.resize(frame_bgr, (img_w, img_h))

        pose = self._load_pose()
        results = pose(resized, verbose=False)
        payload: dict[str, Any] = {
            "frame_shape": resized.shape[:2],
            "keypoints_normalized": None,
            "action": None,
            "confidence": None,
            "raw_result": results[0] if results else None,
        }

        if not results or results[0].keypoints is None:
            return payload

        kpts = results[0].keypoints.xy
        if kpts is None or len(kpts) == 0:
            return payload

        xy = kpts[0].cpu().numpy()
        xy = xy.copy()
        xy[:, 0] /= img_w
        xy[:, 1] /= img_h
        payload["keypoints_normalized"] = xy

        conf_arr = np.ones(17, dtype=np.float32) * 0.5
        try:
            if results[0].keypoints.conf is not None:
                cf = results[0].keypoints.conf[0].cpu().numpy()
                if cf.shape[0] == 17:
                    conf_arr = cf.astype(np.float32)
        except (AttributeError, IndexError, TypeError):
            pass
        payload["keypoint_confidences"] = conf_arr
        flat = xy.flatten()
        self._sequence.append(flat)
        self._sequence = self._sequence[-SEQUENCE_LENGTH:]

        if len(self._sequence) < SEQUENCE_LENGTH:
            return payload

        try:
            lstm = self._load_lstm()
        except FileNotFoundError as e:
            _LOG.warning("%s", e)
            return payload

        inp = np.expand_dims(np.stack(self._sequence, axis=0), axis=0)
        out = lstm.predict(inp, verbose=0)[0]
        conf = float(np.max(out))
        if conf > ACTION_CONFIDENCE_THRESHOLD:
            idx = int(np.argmax(out))
            payload["action"] = ACTION_LABELS[idx] if idx < len(ACTION_LABELS) else "Unknown"
            payload["confidence"] = conf
        return payload
