from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path

# Always resolve scripts from this package so callers cannot pass a wrong `backend_root` (breaks inference).
_GUARDIAN_ROOT = Path(__file__).resolve().parent.parent


def _parse_json_stdout(out: bytes, *, what: str) -> dict:
    text = out.decode("utf-8", errors="replace").strip()
    if not text:
        raise RuntimeError(f"{what} produced empty stdout")
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    for line in reversed(text.splitlines()):
        line = line.strip()
        if line.startswith("{") and line.endswith("}"):
            try:
                return json.loads(line)
            except json.JSONDecodeError:
                continue
    raise RuntimeError(f"{what} stdout is not JSON (first 800 chars): {text[:800]!r}")


async def _communicate_infer(
    python_bin: str,
    script: Path,
    *,
    cwd: Path,
    stdin_payload: bytes | None,
    extra_args: list[str],
) -> tuple[bytes, bytes, int]:
    args_base = [str(script), *extra_args]
    last_exc: OSError | None = None
    for exe in (python_bin, sys.executable):
        exe = (exe or "").strip()
        if not exe:
            continue
        try:
            proc = await asyncio.create_subprocess_exec(
                exe,
                *args_base,
                stdin=asyncio.subprocess.PIPE if stdin_payload is not None else None,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=str(cwd),
            )
            out, err = await proc.communicate(stdin_payload)
            return out, err, proc.returncode or 0
        except OSError as e:
            last_exc = e
            continue
    raise RuntimeError(
        f"Could not start Python for inference (tried {python_bin!r} and {sys.executable!r}): {last_exc!r}"
    )


async def run_clinical_subprocess(python_bin: str, model_path: Path, payload: dict) -> dict:
    script = _GUARDIAN_ROOT / "ml" / "infer_clinical.py"
    out, err, code = await _communicate_infer(
        python_bin,
        script,
        cwd=_GUARDIAN_ROOT,
        stdin_payload=json.dumps(payload).encode("utf-8"),
        extra_args=["--model", str(model_path)],
    )
    if code != 0:
        msg = err.decode("utf-8", errors="replace") or out.decode("utf-8", errors="replace")
        raise RuntimeError(msg or "clinical inference failed")
    return _parse_json_stdout(out, what="clinical inference")


async def run_mri_subprocess(python_bin: str, model_path: Path, image_path: Path) -> dict:
    script = _GUARDIAN_ROOT / "ml" / "infer_mri.py"
    out, err, code = await _communicate_infer(
        python_bin,
        script,
        cwd=_GUARDIAN_ROOT,
        stdin_payload=None,
        extra_args=["--model", str(model_path), "--image", str(image_path)],
    )
    if code != 0:
        msg = err.decode("utf-8", errors="replace") or out.decode("utf-8", errors="replace")
        raise RuntimeError(msg or "mri inference failed")
    return _parse_json_stdout(out, what="MRI inference")


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
