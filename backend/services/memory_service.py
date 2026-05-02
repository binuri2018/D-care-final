"""Voice + memory records (photos / descriptions). Face logic lives in face_recognition_subsystem."""

from __future__ import annotations

import json
import os
import threading
from pathlib import Path
from typing import Any, Optional

import numpy as np

from face_recognition_subsystem import face_database
from face_recognition_subsystem.config import FACE_DB_PATH, MEMORY_DATA_DIR, RECORDS_DIR, VOICES_DIR
from face_recognition_subsystem.recognition_engine import recognize_from_image_bytes
from face_recognition_subsystem.register_batch import register_person_from_still_images

VOICE_MATCH_THRESHOLD = 0.70

_encoder = None
_encoder_lock = threading.Lock()


def _get_voice_encoder():
    global _encoder
    with _encoder_lock:
        if _encoder is None:
            from resemblyzer import VoiceEncoder

            _encoder = VoiceEncoder()
        return _encoder


def list_people() -> list[str]:
    names = set(face_database.list_enrolled_names())
    face_database.ensure_data_layout()
    if RECORDS_DIR.is_dir():
        for p in RECORDS_DIR.iterdir():
            if p.is_dir():
                names.add(p.name)
    return sorted(names)


def identify_face_from_image(image_bytes: bytes) -> tuple[Optional[str], float]:
    """Backward-compatible single-summary result; uses full multi-face subsystem underneath."""
    faces = recognize_from_image_bytes(image_bytes)
    if not faces:
        return None, 1.0
    known = [f for f in faces if f.get("name")]
    if known:
        best = min(known, key=lambda f: f["best_distance"])
        return best["name"], float(best["best_distance"])
    return None, float(faces[0]["best_distance"])


def register_face(name: str, image_files: list[bytes]) -> dict[str, Any]:
    return register_person_from_still_images(name, image_files)


def load_person_record(name: str) -> tuple[str, list[str]]:
    face_database.ensure_data_layout()
    person_dir = RECORDS_DIR / name
    json_path = person_dir / "memories.json"
    description, photos = "", []
    if json_path.is_file():
        with open(json_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        description = data.get("description", "") or ""
        photos = list(data.get("photos", []) or [])
    resolved: list[str] = []
    for p in photos:
        path = Path(p)
        if path.is_file():
            resolved.append(str(path.resolve()))
            continue
        cand = person_dir / Path(p).name
        if cand.is_file():
            resolved.append(str(cand.resolve()))
    return description, resolved


def save_person_memories(name: str, description: str, new_photo_bytes: list[tuple[str, bytes]]) -> dict[str, Any]:
    face_database.ensure_data_layout()
    person_dir = RECORDS_DIR / name.strip()
    person_dir.mkdir(parents=True, exist_ok=True)

    desc_current, photos_current = load_person_record(name.strip())
    desc = description if description is not None else desc_current

    photo_paths: list[str] = []
    seen_names: set[str] = set()
    for old in photos_current:
        base = Path(old).name
        if base not in seen_names:
            seen_names.add(base)
            photo_paths.append(str(person_dir / base))

    for fname, blob in new_photo_bytes:
        safe = Path(fname).name or f"upload_{len(photo_paths)}.jpg"
        dest = person_dir / safe
        with open(dest, "wb") as f:
            f.write(blob)
        if safe not in seen_names:
            seen_names.add(safe)
            photo_paths.append(str(dest.resolve()))

    data = {"description": desc, "photos": photo_paths}
    with open(person_dir / "memories.json", "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)

    return {"name": name.strip(), "photos": len(photo_paths)}


def _decode_audio_bytes_to_mono_16k(audio_bytes: bytes) -> tuple[np.ndarray, int]:
    """Decode browser WebM/Opus or WAV bytes to float32 mono at 16 kHz. Uses ffmpeg if librosa fails."""
    from io import BytesIO
    import shutil
    import subprocess

    import librosa

    if not audio_bytes or len(audio_bytes) < 100:
        raise ValueError("Audio upload is empty or too small")

    try:
        wav, sr = librosa.load(BytesIO(audio_bytes), sr=16000, mono=True)
    except Exception as lib_err:
        ffmpeg = shutil.which("ffmpeg")
        if not ffmpeg:
            raise ValueError(
                "Could not decode microphone audio (WebM/Opus). "
                "Install ffmpeg (https://ffmpeg.org) and add it to PATH so the server can decode browser recordings."
            ) from lib_err
        proc = subprocess.run(
            [
                ffmpeg,
                "-hide_banner",
                "-loglevel",
                "error",
                "-i",
                "pipe:0",
                "-f",
                "s16le",
                "-ac",
                "1",
                "-ar",
                "16000",
                "-acodec",
                "pcm_s16le",
                "pipe:1",
            ],
            input=audio_bytes,
            capture_output=True,
            timeout=120,
            check=False,
        )
        if proc.returncode != 0:
            msg = (proc.stderr or b"").decode("utf-8", errors="replace").strip()[:800]
            raise ValueError(f"ffmpeg could not decode audio: {msg or proc.returncode}") from lib_err
        raw = proc.stdout or b""
        if len(raw) < 2:
            raise ValueError("Decoded audio is empty") from lib_err
        wav = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
        sr = 16000
    if wav.size == 0:
        raise ValueError("Decoded audio is empty")
    return wav, int(sr)


def _prepared_voice_waveform(audio_bytes: bytes) -> np.ndarray:
    from resemblyzer import preprocess_wav

    wav, sr = _decode_audio_bytes_to_mono_16k(audio_bytes)
    return preprocess_wav(wav, source_sr=sr)


def register_voice(name: str, audio_bytes: bytes) -> None:
    if not name.strip():
        raise ValueError("Name is required")
    face_database.ensure_data_layout()
    wav = _prepared_voice_waveform(audio_bytes)
    emb = _get_voice_encoder().embed_utterance(wav)
    np.save(VOICES_DIR / f"{name.strip()}.npy", emb)


def identify_voice_from_wav(audio_bytes: bytes) -> tuple[Optional[str], float]:
    face_database.ensure_data_layout()
    wav = _prepared_voice_waveform(audio_bytes)
    test_embedding = _get_voice_encoder().embed_utterance(wav)

    best_match: Optional[str] = None
    best_score = -1.0
    for file in os.listdir(VOICES_DIR):
        if not file.endswith(".npy"):
            continue
        person = file.replace(".npy", "")
        embedding = np.load(VOICES_DIR / file)
        score = float(np.dot(test_embedding, embedding))
        if score > best_score:
            best_score = score
            best_match = person

    if best_score <= VOICE_MATCH_THRESHOLD:
        return None, best_score
    return best_match, best_score
