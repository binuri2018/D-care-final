"""
HTTP API for the face recognition subsystem (/api/face/*).
Implements identify (multi-face), batch register, and WebRTC-style session register with cooldown.
"""

from __future__ import annotations

from fastapi import APIRouter, File, Form, HTTPException, Query, UploadFile

from face_recognition_subsystem import face_database
from face_recognition_subsystem.config import (
    FACE_DB_PATH,
    FACE_MATCH_DISTANCE_THRESHOLD,
    MAX_REGISTRATION_EMBEDDINGS,
    REGISTRATION_DIVERSITY_THRESHOLD,
    REGISTRATION_FRAME_COOLDOWN_SEC,
)
from face_recognition_subsystem.recognition_engine import recognize_from_image_bytes
from face_recognition_subsystem.register_batch import register_person_from_still_images
from face_recognition_subsystem.registration_session import (
    create_session,
    delete_session,
    finalize_session_partial,
    process_session_frame_bytes,
    session_status,
    update_session_name,
)

router = APIRouter(tags=["face_recognition_subsystem"])


@router.get("/face/constants")
def face_subsystem_constants():
    """Original app.py thresholds, for clients that mirror Streamlit behavior."""
    return {
        "face_match_distance_threshold": FACE_MATCH_DISTANCE_THRESHOLD,
        "max_registration_embeddings": MAX_REGISTRATION_EMBEDDINGS,
        "registration_diversity_threshold": REGISTRATION_DIVERSITY_THRESHOLD,
        "registration_frame_cooldown_sec": REGISTRATION_FRAME_COOLDOWN_SEC,
    }


@router.get("/face/database/people")
def face_list_enrolled():
    return {"people": face_database.list_enrolled_names()}


@router.get("/face/health")
def face_subsystem_health():
    face_database.ensure_data_layout()
    return {"face_db_ready": FACE_DB_PATH.exists(), "subsystem": "face_recognition"}


@router.post("/face/identify")
async def face_identify(
    image: UploadFile = File(...),
    input_bgr: bool = Query(False),
):
    """
    Full-frame identification — returns one result per detected face (RecognitionProcessor logic).
    Use query ?input_bgr=true for raw BGR/JPEG bytes; default RGB upload from browser canvas.
    """
    data = await image.read()
    try:
        faces = recognize_from_image_bytes(data, input_bgr=input_bgr)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"Face processing failed: {e}") from e
    first_known = next((f for f in faces if f.get("name")), None)
    return {
        "faces": faces,
        "face_count": len(faces),
        "primary_name": first_known["name"] if first_known else None,
        "primary_distance": first_known["best_distance"] if first_known else None,
    }


@router.post("/face/register/batch")
async def face_register_batch(
    name: str = Form(...),
    images: list[UploadFile] = File(...),
):
    blobs = [await img.read() for img in images]
    if not blobs:
        raise HTTPException(status_code=400, detail="At least one image is required")
    try:
        return register_person_from_still_images(name, blobs)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.post("/face/register/session")
def face_register_session_start(name: str = Form("")):
    sid = create_session(name.strip())
    return {"session_id": sid, "name": name.strip()}


@router.get("/face/register/session/{session_id}")
def face_register_session_get(session_id: str):
    try:
        return session_status(session_id)
    except KeyError as e:
        raise HTTPException(status_code=404, detail="Session not found") from e


@router.patch("/face/register/session/{session_id}/name")
def face_register_session_rename(session_id: str, name: str = Form(...)):
    try:
        update_session_name(session_id, name)
    except KeyError as e:
        raise HTTPException(status_code=404, detail="Session not found") from e
    return {"session_id": session_id, "name": name.strip()}


@router.post("/face/register/session/{session_id}/frame")
async def face_register_session_frame(
    session_id: str,
    image: UploadFile = File(...),
    input_bgr: bool = Query(False),
):
    data = await image.read()
    try:
        result = process_session_frame_bytes(session_id, data, input_bgr=input_bgr)
    except KeyError as e:
        raise HTTPException(status_code=404, detail="Session not found") from e
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    if result.get("committed"):
        delete_session(session_id)
    return result


@router.post("/face/register/session/{session_id}/finalize")
def face_register_session_finalize(session_id: str):
    try:
        return finalize_session_partial(session_id)
    except KeyError as e:
        raise HTTPException(status_code=404, detail="Session not found") from e
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.delete("/face/register/session/{session_id}")
def face_register_session_abort(session_id: str):
    if not delete_session(session_id):
        raise HTTPException(status_code=404, detail="Session not found")
    return {"status": "aborted"}
