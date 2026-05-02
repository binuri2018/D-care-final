"""Public exports for the face recognition subsystem (standalone from voice/memory UI)."""

from face_recognition_subsystem.config import (
    FACE_DB_PATH,
    FACE_MATCH_DISTANCE_THRESHOLD,
    MAX_REGISTRATION_EMBEDDINGS,
    MEMORY_DATA_DIR,
    MEMORY_SEED_DIR,
    RECORDS_DIR,
    REGISTRATION_DIVERSITY_THRESHOLD,
    REGISTRATION_FRAME_COOLDOWN_SEC,
    VOICES_DIR,
)
from face_recognition_subsystem.face_database import (
    ensure_data_layout,
    list_enrolled_names,
    load_db,
    load_db_unlocked,
    save_db,
)
from face_recognition_subsystem.recognition_engine import (
    bgr24_to_rgb,
    image_bytes_to_rgb,
    recognize_all_faces_rgb,
    recognize_from_image_bytes,
)
from face_recognition_subsystem.register_batch import register_person_from_still_images
from face_recognition_subsystem.registration_session import (
    RegisterProcessorState,
    create_session,
    delete_session,
    finalize_session_partial,
    get_session,
    process_session_frame_bytes,
    session_status,
    update_session_name,
)

__all__ = [
    "MEMORY_DATA_DIR",
    "MEMORY_SEED_DIR",
    "FACE_DB_PATH",
    "RECORDS_DIR",
    "VOICES_DIR",
    "FACE_MATCH_DISTANCE_THRESHOLD",
    "MAX_REGISTRATION_EMBEDDINGS",
    "REGISTRATION_DIVERSITY_THRESHOLD",
    "REGISTRATION_FRAME_COOLDOWN_SEC",
    "ensure_data_layout",
    "load_db",
    "load_db_unlocked",
    "save_db",
    "list_enrolled_names",
    "image_bytes_to_rgb",
    "bgr24_to_rgb",
    "recognize_all_faces_rgb",
    "recognize_from_image_bytes",
    "register_person_from_still_images",
    "RegisterProcessorState",
    "create_session",
    "delete_session",
    "finalize_session_partial",
    "get_session",
    "process_session_frame_bytes",
    "session_status",
    "update_session_name",
]
