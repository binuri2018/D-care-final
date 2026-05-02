from __future__ import annotations

from pathlib import Path
from typing import Optional

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse

from services import memory_service as mem
from face_recognition_subsystem.recognition_engine import recognize_from_image_bytes

router = APIRouter(tags=["memory"])


def _safe_part(s: str) -> str:
    return Path(s).name


@router.get("/memory/people")
def memory_list_people():
    return {"people": mem.list_people()}


@router.get("/memory/people/{name}")
def memory_get_person(name: str):
    name = name.strip()
    desc, photos = mem.load_person_record(name)
    rel_urls = []
    for p in photos:
        fp = Path(p)
        if not fp.is_file():
            continue
        try:
            fp.resolve().relative_to(mem.RECORDS_DIR.resolve())
        except ValueError:
            continue
        rel_urls.append(f"/api/memory/records/{name}/{fp.name}")
    return {"name": name, "description": desc, "photo_urls": rel_urls}


@router.put("/memory/people/{name}/memories")
async def memory_save_memories(
    name: str,
    description: str = Form(""),
    photos: Optional[list[UploadFile]] = File(None),
):
    name = name.strip()
    pairs: list[tuple[str, bytes]] = []
    for uf in photos or []:
        if uf.filename:
            pairs.append((uf.filename, await uf.read()))
    try:
        out = mem.save_person_memories(name, description, pairs)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=str(e)) from e
    return out


@router.get("/memory/records/{person}/{filename}")
def memory_fetch_photo(person: str, filename: str):
    person = _safe_part(person)
    filename = _safe_part(filename)
    path = mem.RECORDS_DIR / person / filename
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Photo not found")
    try:
        path.resolve().relative_to(mem.RECORDS_DIR.resolve())
    except ValueError as e:
        raise HTTPException(status_code=400, detail="Invalid path") from e
    return FileResponse(path)


@router.post("/memory/face/identify")
async def memory_identify_face(image: UploadFile = File(...)):
    data = await image.read()
    try:
        faces = recognize_from_image_bytes(data)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"Face processing failed: {e}") from e
    first_known = next((f for f in faces if f.get("name")), None)
    return {
        "faces": faces,
        "face_count": len(faces),
        "name": first_known["name"] if first_known else None,
        "distance": first_known["best_distance"] if first_known else (faces[0]["best_distance"] if faces else None),
    }


@router.post("/memory/face/register")
async def memory_register_face(
    name: str = Form(...),
    images: list[UploadFile] = File(...),
):
    blobs = [await img.read() for img in images]
    if not blobs:
        raise HTTPException(status_code=400, detail="At least one image is required")
    try:
        return mem.register_face(name, blobs)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.post("/memory/voice/register")
async def memory_register_voice(
    name: str = Form(...),
    audio: UploadFile = File(...),
):
    data = await audio.read()
    if len(data) < 100:
        raise HTTPException(status_code=400, detail="Audio too short")
    try:
        mem.register_voice(name, data)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=str(e)) from e
    return {"status": "ok", "name": name.strip()}


@router.post("/memory/voice/identify")
async def memory_identify_voice(audio: UploadFile = File(...)):
    data = await audio.read()
    if len(data) < 100:
        raise HTTPException(status_code=400, detail="Audio too short")
    try:
        name, score = mem.identify_voice_from_wav(data)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=str(e)) from e
    return {"name": name, "score": score}


@router.get("/memory/health")
def memory_health():
    ok = mem.FACE_DB_PATH.exists()
    return {"face_db_ready": ok, "data_dir": str(mem.MEMORY_DATA_DIR)}
