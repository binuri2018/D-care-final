"""
Face identification — exact logic from RecognitionProcessor.recv() in app.py:

    rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
    locations = face_recognition.face_locations(rgb)
    encodings = face_recognition.face_encodings(rgb, locations)
    for each face: compare to all stored embeddings, L2 norm; threshold 0.48
"""

from __future__ import annotations

from io import BytesIO
from typing import Any, Optional

import face_recognition
import numpy as np
from PIL import Image

from face_recognition_subsystem.config import FACE_MATCH_DISTANCE_THRESHOLD
from face_recognition_subsystem import face_database


def image_bytes_to_rgb(image_bytes: bytes) -> np.ndarray:
    """Web uploads are decoded the same way face_recognition expects RGB ndarray."""
    img = Image.open(BytesIO(image_bytes)).convert("RGB")
    return np.asarray(img)


def bgr24_to_rgb(img_bgr: np.ndarray) -> np.ndarray:
    """Mirror: rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)"""
    import cv2

    return cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB)


def _match_one_face(encoding: np.ndarray, db: dict[str, Any]) -> tuple[str, float]:
    """Single face branch from RecognitionProcessor.recv inner loop."""
    name = "Unknown"
    best_distance: float = 1.0
    for person, data in db.items():
        for stored_encoding in data["embeddings"]:
            distance = float(np.linalg.norm(stored_encoding - encoding))
            if distance < best_distance:
                best_distance = distance
                name = person
    if best_distance > FACE_MATCH_DISTANCE_THRESHOLD:
        name = "Unknown"
    return name, best_distance


def recognize_all_faces_rgb(
    rgb: np.ndarray,
    db: Optional[dict[str, Any]] = None,
) -> list[dict[str, Any]]:
    """
    Full-frame identification — one entry per detected face (original loops all faces).
    """
    if db is None:
        db = face_database.load_db()
    locations = face_recognition.face_locations(rgb)
    encodings = face_recognition.face_encodings(rgb, locations)
    out: list[dict[str, Any]] = []
    for (top, right, bottom, left), encoding in zip(locations, encodings):
        label, best_distance = _match_one_face(encoding, db)
        out.append(
            {
                "name": None if label == "Unknown" else label,
                "unknown": label == "Unknown",
                "best_distance": best_distance,
                "bbox": {"top": int(top), "right": int(right), "bottom": int(bottom), "left": int(left)},
            }
        )
    return out


def recognize_from_image_bytes(
    image_bytes: bytes,
    *,
    input_bgr: bool = False,
) -> list[dict[str, Any]]:
    if not image_bytes or len(image_bytes) < 32:
        raise ValueError("Image upload is empty or too small")
    if input_bgr:
        import cv2

        arr = np.frombuffer(image_bytes, dtype=np.uint8)
        bgr = cv2.imdecode(arr, cv2.IMREAD_COLOR)
        if bgr is None:
            raise ValueError("Could not decode BGR image")
        rgb = bgr24_to_rgb(bgr)
    else:
        rgb = image_bytes_to_rgb(image_bytes)
    return recognize_all_faces_rgb(rgb)
