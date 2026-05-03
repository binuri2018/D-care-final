from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path


async def run_clinical_subprocess(backend_root: Path, python_bin: str, model_path: Path, payload: dict) -> dict:
    script = backend_root / "ml" / "infer_clinical.py"
    proc = await asyncio.create_subprocess_exec(
        python_bin,
        str(script),
        "--model",
        str(model_path),
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        cwd=str(backend_root),
    )
    out, err = await proc.communicate(json.dumps(payload).encode("utf-8"))
    if proc.returncode != 0:
        msg = err.decode("utf-8", errors="replace") or out.decode("utf-8", errors="replace")
        raise RuntimeError(msg or "clinical inference failed")
    return json.loads(out.decode("utf-8"))


async def run_mri_subprocess(
    backend_root: Path, python_bin: str, model_path: Path, image_path: Path
) -> dict:
    script = backend_root / "ml" / "infer_mri.py"
    proc = await asyncio.create_subprocess_exec(
        python_bin,
        str(script),
        "--model",
        str(model_path),
        "--image",
        str(image_path),
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        cwd=str(backend_root),
    )
    out, err = await proc.communicate()
    if proc.returncode != 0:
        msg = err.decode("utf-8", errors="replace") or out.decode("utf-8", errors="replace")
        raise RuntimeError(msg or "mri inference failed")
    return json.loads(out.decode("utf-8"))


def clinical_payload_from_form(body: dict) -> dict:
    return {
        "Age": float(body["age"]),
        "BMI": float(body["bmi"]),
        "EducationLevel": float(body["educationLevel"]),
        "MMSE": float(body["mmse"]),
        "FunctionalAssessment": float(body["functionalAssessment"]),
        "MemoryComplaints": float(body["memoryComplaints"]),
        "Forgetfulness": float(body["forgetfulness"]),
    }
