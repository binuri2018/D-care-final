"""Paths and constants matching the original Streamlit face app (app.py)."""

from __future__ import annotations

import os
from pathlib import Path

# Original: DB_PATH = "face_db.pkl", RECORDS_DIR = "records"
MEMORY_DATA_DIR = Path(
    os.environ.get("MEMORY_DATA_DIR", Path(__file__).resolve().parent.parent / "memory_data")
)
MEMORY_SEED_DIR = Path(__file__).resolve().parent.parent / "memory_seed"

FACE_DB_FILENAME = "face_db.pkl"
FACE_DB_PATH = MEMORY_DATA_DIR / FACE_DB_FILENAME
RECORDS_DIR = MEMORY_DATA_DIR / "records"
VOICES_DIR = MEMORY_DATA_DIR / "voices"

# Original RecognitionProcessor: if best_distance > 0.48: name = "Unknown"
FACE_MATCH_DISTANCE_THRESHOLD = 0.48

# Original RegisterProcessor
MAX_REGISTRATION_EMBEDDINGS = 12
REGISTRATION_DIVERSITY_THRESHOLD = 0.35
REGISTRATION_FRAME_COOLDOWN_SEC = 0.8
