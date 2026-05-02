"""
Streaming registration — state machine from RegisterProcessor in app.py:

- max_images = 12, diversity_threshold = 0.35, capture_cooldown = 0.8
- Only when len(locations) == 1 and embeddings < max and cooldown elapsed and is_diverse
- When len(embeddings) >= max_images: commit to db like original (merge key if needed)
"""

from __future__ import annotations

import time
import uuid
from threading import Lock
from typing import Any, Optional

import face_recognition
import numpy as np

from face_recognition_subsystem.config import (
    MAX_REGISTRATION_EMBEDDINGS,
    REGISTRATION_DIVERSITY_THRESHOLD,
    REGISTRATION_FRAME_COOLDOWN_SEC,
)
from face_recognition_subsystem import face_database
from face_recognition_subsystem.recognition_engine import bgr24_to_rgb, image_bytes_to_rgb


class RegisterProcessorState:
    """
    Mirrors RegisterProcessor fields and recv() embedding capture rules (without drawing).
    """

    def __init__(self, name: str = "") -> None:
        self.name = name
        self.db = face_database.load_db_unlocked()
        self.embeddings: list[np.ndarray] = []
        self.max_images = MAX_REGISTRATION_EMBEDDINGS
        self.diversity_threshold = REGISTRATION_DIVERSITY_THRESHOLD
        self.last_capture_time = 0.0
        self.capture_cooldown = REGISTRATION_FRAME_COOLDOWN_SEC

    def is_diverse(self, new_embedding: np.ndarray) -> bool:
        if not self.embeddings:
            return True
        return all(
            float(np.linalg.norm(emb - new_embedding)) > self.diversity_threshold for emb in self.embeddings
        )

    def process_rgb_frame(self, rgb: np.ndarray) -> dict[str, Any]:
        """Logic from RegisterProcessor.recv after BGR→RGB (no OpenCV overlay)."""
        if not getattr(self, "name", ""):
            locations = face_recognition.face_locations(rgb)
            return {
                "captures": len(self.embeddings),
                "max_images": self.max_images,
                "face_count": len(locations),
                "committed": False,
                "needs_name": True,
            }

        locations = face_recognition.face_locations(rgb)
        encodings = face_recognition.face_encodings(rgb, locations)

        if len(locations) == 1 and len(self.embeddings) < self.max_images:
            if time.time() - self.last_capture_time > self.capture_cooldown:
                new_emb = encodings[0]
                if self.is_diverse(new_emb):
                    self.embeddings.append(new_emb)
                    self.last_capture_time = time.time()

        committed = False
        if len(self.embeddings) >= self.max_images:
            if self.name not in self.db:
                self.db[self.name] = {"embeddings": []}
            self.db[self.name]["embeddings"] = self.embeddings
            face_database.save_db(self.db)
            committed = True

        return {
            "captures": len(self.embeddings),
            "max_images": self.max_images,
            "face_count": len(locations),
            "committed": committed,
            "needs_name": False,
        }


_sessions: dict[str, RegisterProcessorState] = {}
_sessions_lock = Lock()


def create_session(person_name: str) -> str:
    sid = uuid.uuid4().hex
    with _sessions_lock:
        _sessions[sid] = RegisterProcessorState(name=person_name.strip())
    return sid


def get_session(session_id: str) -> Optional[RegisterProcessorState]:
    with _sessions_lock:
        return _sessions.get(session_id)


def delete_session(session_id: str) -> bool:
    with _sessions_lock:
        return _sessions.pop(session_id, None) is not None


def process_session_frame_bytes(session_id: str, image_bytes: bytes, *, input_bgr: bool = False) -> dict[str, Any]:
    state = get_session(session_id)
    if not state:
        raise KeyError("Unknown or expired registration session")
    if input_bgr:
        import cv2

        arr = np.frombuffer(image_bytes, dtype=np.uint8)
        bgr = cv2.imdecode(arr, cv2.IMREAD_COLOR)
        if bgr is None:
            raise ValueError("Could not decode BGR image")
        rgb = bgr24_to_rgb(bgr)
    else:
        rgb = image_bytes_to_rgb(image_bytes)
    return state.process_rgb_frame(rgb)


def session_status(session_id: str) -> dict[str, Any]:
    state = get_session(session_id)
    if not state:
        raise KeyError("Unknown session")
    return {
        "session_id": session_id,
        "name": state.name,
        "captures": len(state.embeddings),
        "max_images": state.max_images,
    }


def update_session_name(session_id: str, person_name: str) -> None:
    state = get_session(session_id)
    if not state:
        raise KeyError("Unknown session")
    state.name = person_name.strip()
    state.db = face_database.load_db_unlocked()


def finalize_session_partial(session_id: str) -> dict[str, Any]:
    """
    Persist whatever embeddings were collected (< 12), mirroring early save if user stops stream.
    Original only saves when embeddings >= 12; for UX we allow explicit finalize with >=1 embedding.
    """
    state = get_session(session_id)
    if not state:
        raise KeyError("Unknown session")
    if not state.name:
        raise ValueError("Person name is required")
    if not state.embeddings:
        raise ValueError("No embeddings captured yet")
    if state.name not in state.db:
        state.db[state.name] = {"embeddings": []}
    state.db[state.name]["embeddings"] = state.embeddings
    face_database.save_db(state.db)
    delete_session(session_id)
    return {"name": state.name, "embeddings_saved": len(state.embeddings)}
