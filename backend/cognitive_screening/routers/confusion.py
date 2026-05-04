"""Webcam JPEG frame → YOLO ``best.pt`` facial confusion (standard JSON, see ``confusion_yolo``)."""

from __future__ import annotations

from fastapi import APIRouter, File, HTTPException, UploadFile

from cognitive_screening.services.confusion_yolo import MAX_FRAME_BYTES, analyze_confusion_frame_bytes

router = APIRouter(prefix="/api", tags=["confusion"])


@router.post("/analyze-confusion-frame")
async def analyze_confusion_frame(file: UploadFile = File(...)) -> dict:
    data = await file.read()
    if not data:
        raise HTTPException(400, "Empty upload.")
    if len(data) > MAX_FRAME_BYTES:
        raise HTTPException(413, f"Frame too large (max {MAX_FRAME_BYTES // (1024 * 1024)} MB).")
    # Browsers often send webcam blobs as application/octet-stream or omit the part MIME type;
    # only reject clearly non-image declared types.
    ct = (file.content_type or "").strip().lower()
    if ct and not (ct.startswith("image/") or ct == "application/octet-stream"):
        raise HTTPException(400, "Upload an image (JPEG or PNG).")
    try:
        out = analyze_confusion_frame_bytes(data)
        # Always 200 for valid image uploads so high-frequency webcam polling is not
        # treated as HTTP errors; check JSON ``ok`` for YOLO availability.
        return out
    except ValueError as e:
        if str(e) == "file_too_large":
            raise HTTPException(413, "Frame too large.") from e
        raise HTTPException(400, str(e)) from e
