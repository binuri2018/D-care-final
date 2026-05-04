"""Webcam JPEG frame -> confusion score (YOLOv8 when weights present)."""

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
        # Return 200 even when YOLO weights are missing: body already has neutral
        # emotion/score + `note` for ops; 503 would fail fetch() every webcam frame.
        return out
    except ValueError as e:
        if str(e) == "file_too_large":
            raise HTTPException(413, "Frame too large.") from e
        raise HTTPException(400, str(e)) from e
