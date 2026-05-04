"""
Webcam-frame facial confusion — **Ultralytics YOLO `best.pt` only** (cognitive screening).

Weights resolve in order:
  1. ``CONFUSION_YOLO_PATH`` (absolute or relative to cwd / repo / backend)
  2. ``<repo>/data/confusion_model/best.pt``
  3. ``cognitive_screening/ml_artifacts/confusion_yolo/best.pt``
  4. ``cognitive_screening/ml_artifacts/best.pt``
  5. Any ``best.pt`` under ``ml_artifacts/`` (shallow paths first)

Install: ``pip install ultralytics``.

API shape for ``POST /api/analyze-confusion-frame`` is built by ``build_yolo_frame_response`` / ``analyze_confusion_frame_bytes``.
"""

from __future__ import annotations

import io
import logging
import os
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image

_MODEL: Any = None
_MODEL_PATH: Path | None = None
_WARNED_NO_WEIGHTS = False

log = logging.getLogger(__name__)

MAX_FRAME_BYTES = 4 * 1024 * 1024

SOURCE_BEST_PT = "best.pt"


def _yolo_debug_enabled() -> bool:
    v = (os.environ.get("COGNITIVE_YOLO_DEBUG") or os.environ.get("DEBUG") or "").strip().lower()
    if v in ("1", "true", "yes"):
        return True
    return os.environ.get("ENVIRONMENT", "").strip().lower() in ("development", "dev")


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[3]


def _ml_artifacts_root() -> Path:
    return Path(__file__).resolve().parents[1] / "ml_artifacts"


def _discover_best_pt_under(ml_root: Path) -> Path | None:
    if not ml_root.is_dir():
        return None
    found: list[Path] = []
    try:
        for p in ml_root.rglob("best.pt"):
            if p.is_file():
                found.append(p)
    except OSError:
        return None
    if not found:
        return None
    found.sort(key=lambda x: (len(x.relative_to(ml_root).parts), str(x).lower()))
    return found[0]


def default_model_path() -> Path | None:
    env = os.environ.get("CONFUSION_YOLO_PATH")
    if env:
        raw = Path(env)
        if raw.is_file():
            return raw
        repo = _repo_root()
        for base in (Path.cwd(), repo, repo / "backend"):
            cand = (base / raw).resolve()
            if cand.is_file():
                return cand
        return None

    ml_root = _ml_artifacts_root()
    candidates = [
        _repo_root() / "data" / "confusion_model" / "best.pt",
        ml_root / "confusion_yolo" / "best.pt",
        ml_root / "best.pt",
    ]
    for p in candidates:
        if p.is_file():
            return p
    return _discover_best_pt_under(ml_root)


def _warn_weights_once(msg: str) -> None:
    global _WARNED_NO_WEIGHTS
    if not _WARNED_NO_WEIGHTS:
        log.warning("%s", msg)
        _WARNED_NO_WEIGHTS = True


def _load_yolo():
    global _MODEL, _MODEL_PATH
    path = default_model_path()
    if path is None:
        _MODEL = None
        _MODEL_PATH = None
        _warn_weights_once(
            "[YOLO confusion] best.pt not found - webcam confusion unavailable. "
            "Place weights under cognitive_screening/ml_artifacts/ or set CONFUSION_YOLO_PATH."
        )
        return None
    if _MODEL is not None and _MODEL_PATH == path:
        return _MODEL
    _MODEL = None
    _MODEL_PATH = None
    try:
        from ultralytics import YOLO  # noqa: PLC0415
    except ImportError:
        _warn_weights_once(
            "[YOLO confusion] ultralytics not installed — pip install ultralytics"
        )
        return None
    _MODEL = YOLO(str(path))
    _MODEL_PATH = path
    if _yolo_debug_enabled():
        log.info("[YOLO confusion] model loaded: %s", path)
    return _MODEL


def confusion_level_from_score(u: float) -> str:
    if u < 0.35:
        return "low"
    if u < 0.65:
        return "medium"
    return "high"


def _intrinsic_confusion_0_1_from_label(raw_label: str, class_id: int) -> float:
    """Base confusion intensity 0..1 from YOLO class name (before detector confidence blend)."""
    n = (raw_label or "").lower().strip().replace("_", " ")

    high = (
        "confus",
        "anxious",
        "anxiety",
        "fear",
        "afraid",
        "scared",
        "terrified",
        "sad",
        "distress",
        "stress",
        "worried",
        "overwhelm",
    )
    low = (
        "neutral",
        "normal",
        "happy",
        "calm",
        "focused",
        "attentive",
        "content",
        "smile",
        "relaxed",
    )
    if any(k in n for k in high):
        return 0.88
    if any(k in n for k in low):
        return 0.10

    mid_high = ("angry", "anger", "frustrat", "disgust", "upset", "tired", "fatigue")
    if any(k in n for k in mid_high):
        return 0.62

    if "surpris" in n:
        return 0.38

    if class_id >= 2:
        return 0.72
    if class_id == 1:
        return 0.45
    return 0.28


def _emotion_from_label(raw_label: str, class_id: int) -> str:
    n = (raw_label or "").lower()
    if any(
        x in n
        for x in (
            "confus",
            "anxious",
            "anxiety",
            "fear",
            "sad",
            "angry",
            "frustrat",
            "worried",
            "stress",
        )
    ):
        return "confused"
    if "happy" in n or "smile" in n:
        return "happy"
    if "focused" in n or "attentive" in n:
        return "focused"
    if any(x in n for x in ("neutral", "normal", "calm")):
        return "neutral"
    if class_id >= 2:
        return "confused"
    if class_id == 1:
        return "neutral"
    return "neutral"


def build_yolo_frame_response(
    *,
    ok: bool,
    confusion_score_0_1: float | None,
    emotion: str | None,
    predicted_label: str | None,
    model_confidence: float | None,
    raw_model_label: str | None,
    source: str | None,
    error: str | None = None,
    note: str | None = None,
) -> dict[str, Any]:
    u = None if confusion_score_0_1 is None else float(max(0.0, min(1.0, confusion_score_0_1)))
    out: dict[str, Any] = {
        "ok": ok,
        "source": source,
        "confusion_score": u,
        "confusion_level": confusion_level_from_score(u) if u is not None else None,
        "emotion": emotion,
        "predicted_label": predicted_label,
        "model_confidence": model_confidence,
        "raw_model_label": raw_model_label,
    }
    if error:
        out["error"] = error
    if note:
        out["note"] = note
    return out


def analyze_confusion_frame_bytes(data: bytes) -> dict[str, Any]:
    if len(data) > MAX_FRAME_BYTES:
        raise ValueError("file_too_large")

    model = _load_yolo()
    if model is None:
        return build_yolo_frame_response(
            ok=False,
            confusion_score_0_1=None,
            emotion=None,
            predicted_label=None,
            model_confidence=None,
            raw_model_label=None,
            source=None,
            error="YOLO weights (best.pt) or ultralytics runtime unavailable.",
            note="Place best.pt under cognitive_screening/ml_artifacts/ or set CONFUSION_YOLO_PATH.",
        )

    try:
        im = Image.open(io.BytesIO(data)).convert("RGB")
        results = model.predict(source=im, conf=0.22, verbose=False)
        names = getattr(results[0], "names", None) or {}

        if not results or results[0].boxes is None or len(results[0].boxes) == 0:
            u = 0.12
            resp = build_yolo_frame_response(
                ok=True,
                confusion_score_0_1=u,
                emotion="neutral",
                predicted_label=None,
                model_confidence=0.0,
                raw_model_label=None,
                source=SOURCE_BEST_PT,
                note="No detection above threshold; low facial-confusion signal.",
            )
            if _yolo_debug_enabled():
                log.info(
                    "[YOLO confusion] prediction: label=%s conf=%s confusion_score=%s confusion_level=%s",
                    None,
                    0.0,
                    u,
                    resp["confusion_level"],
                )
            return resp

        boxes = results[0].boxes
        confs = boxes.conf.cpu().numpy()
        clss = boxes.cls.cpu().numpy().astype(int)
        i = int(np.argmax(confs))
        cls_id = int(clss[i])
        conf = float(max(0.0, min(1.0, float(confs[i]))))
        raw_label = str(names.get(cls_id, f"class_{cls_id}"))
        base = _intrinsic_confusion_0_1_from_label(raw_label, cls_id)
        prior = 0.15
        u = conf * base + (1.0 - conf) * prior
        u = float(max(0.0, min(1.0, u)))
        emotion = _emotion_from_label(raw_label, cls_id)

        resp = build_yolo_frame_response(
            ok=True,
            confusion_score_0_1=u,
            emotion=emotion,
            predicted_label=raw_label,
            model_confidence=conf,
            raw_model_label=raw_label,
            source=SOURCE_BEST_PT,
            note=f"Top detection from {(_MODEL_PATH.name if _MODEL_PATH else 'best.pt')}.",
        )
        if _yolo_debug_enabled():
            log.info(
                "[YOLO confusion] prediction: label=%r conf=%s confusion_score=%s confusion_level=%s",
                raw_label,
                conf,
                u,
                resp["confusion_level"],
            )
        return resp
    except Exception as e:  # noqa: BLE001
        msg = f"{type(e).__name__}: {e}"
        log.exception("[YOLO confusion] inference failed: %s", msg)
        return build_yolo_frame_response(
            ok=False,
            confusion_score_0_1=None,
            emotion=None,
            predicted_label=None,
            model_confidence=None,
            raw_model_label=None,
            source=SOURCE_BEST_PT,
            error=msg,
            note="Inference error; client should use fallback.",
        )
