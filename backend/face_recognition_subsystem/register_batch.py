"""
Batch registration from still images — same diversity / single-face / max-12 rules as RegisterProcessor.recv,
without inter-frame time cooldown (each uploaded image is treated as a separate opportunity).
"""

from __future__ import annotations

import face_recognition
import numpy as np

from face_recognition_subsystem.config import (
    MAX_REGISTRATION_EMBEDDINGS,
    REGISTRATION_DIVERSITY_THRESHOLD,
)
from face_recognition_subsystem import face_database
from face_recognition_subsystem.recognition_engine import image_bytes_to_rgb


def register_person_from_still_images(name: str, image_files: list[bytes]) -> dict:
    if not name.strip():
        raise ValueError("Name is required")
    name = name.strip()
    embeddings: list[np.ndarray] = []

    for raw in image_files:
        rgb = image_bytes_to_rgb(raw)
        locations = face_recognition.face_locations(rgb)
        encs = face_recognition.face_encodings(rgb, locations)
        if len(locations) != 1 or not encs:
            continue
        new_emb = encs[0]
        if not embeddings:
            embeddings.append(new_emb)
        elif len(embeddings) < MAX_REGISTRATION_EMBEDDINGS and all(
            float(np.linalg.norm(new_emb - emb)) > REGISTRATION_DIVERSITY_THRESHOLD for emb in embeddings
        ):
            embeddings.append(new_emb)

    if not embeddings:
        raise ValueError("No valid single-face images were found; add clearer photos.")

    db = face_database.load_db()
    db[name] = {"embeddings": embeddings}
    face_database.save_db(db)

    return {"name": name, "embeddings_saved": len(embeddings)}
