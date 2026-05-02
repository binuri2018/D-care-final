"""
Face embedding database — exact pickle format: { person: { "embeddings": [np.ndarray, ...] } }
Matches original load_db / save_db in app.py.
"""

from __future__ import annotations

import os
import pickle
import shutil
import threading
from typing import Any

from face_recognition_subsystem.config import (
    FACE_DB_PATH,
    MEMORY_DATA_DIR,
    MEMORY_SEED_DIR,
    RECORDS_DIR,
    VOICES_DIR,
)

_db_lock = threading.Lock()


def ensure_data_layout() -> None:
    """Create dirs and seed from facial project when local DB is missing."""
    MEMORY_DATA_DIR.mkdir(parents=True, exist_ok=True)
    RECORDS_DIR.mkdir(parents=True, exist_ok=True)
    VOICES_DIR.mkdir(parents=True, exist_ok=True)
    seed_pkl = MEMORY_SEED_DIR / "face_db.pkl"
    if not FACE_DB_PATH.exists() and seed_pkl.exists():
        shutil.copy2(seed_pkl, FACE_DB_PATH)
    for sub in ("records", "voices"):
        src = MEMORY_SEED_DIR / sub
        if not src.is_dir():
            continue
        for root, _dirs, files in os.walk(src):
            rel = os.path.relpath(root, src)
            dest_root = MEMORY_DATA_DIR / sub / rel if rel != "." else MEMORY_DATA_DIR / sub
            dest_root.mkdir(parents=True, exist_ok=True)
            for f in files:
                s, d = os.path.join(root, f), dest_root / f
                if not d.exists():
                    shutil.copy2(s, d)


def load_db_unlocked() -> dict[str, Any]:
    """Original load_db(): return {} if missing or corrupt."""
    ensure_data_layout()
    if not FACE_DB_PATH.exists():
        return {}
    with open(FACE_DB_PATH, "rb") as f:
        try:
            return pickle.load(f)
        except (EOFError, pickle.UnpicklingError):
            return {}


def load_db() -> dict[str, Any]:
    with _db_lock:
        return load_db_unlocked()


def save_db(db: dict[str, Any]) -> None:
    """Original save_db(): pickle.dump entire db."""
    ensure_data_layout()
    tmp = FACE_DB_PATH.with_suffix(".tmp")
    with _db_lock:
        with open(tmp, "wb") as f:
            pickle.dump(db, f)
        tmp.replace(FACE_DB_PATH)


def list_enrolled_names() -> list[str]:
    with _db_lock:
        db = load_db_unlocked()
    return sorted(db.keys())
