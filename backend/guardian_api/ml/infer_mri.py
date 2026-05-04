#!/usr/bin/env python3
"""MRI Keras inference for Dementia Guardian (same weights/preprocess as cognitive screening MRI)."""
import argparse
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

_BACKEND_ROOT = Path(__file__).resolve().parents[2]
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))
from cognitive_screening.services.mri_keras_load import load_mri_keras_model

MRI_LABELS = {
    0: "Non-Demented",
    1: "Very Mild",
    2: "Mild",
    3: "Moderate",
}

MRI_RISK_MAP = {
    0: "low",
    1: "medium",
    2: "high",
    3: "critical",
}


def preprocess_image_path(image_path: Path) -> np.ndarray:
    im = Image.open(image_path).convert("RGB")
    im = im.resize((224, 224), Image.Resampling.BILINEAR)
    rgb = np.asarray(im, dtype=np.float32)
    try:
        import tensorflow as tf  # noqa: PLC0415

        x = tf.keras.applications.mobilenet_v2.preprocess_input(rgb)
        return np.expand_dims(np.asarray(x, dtype=np.float32), axis=0)
    except Exception:
        return np.expand_dims(rgb / 127.5 - 1.0, axis=0)


def to_probabilities(output: np.ndarray) -> np.ndarray:
    output = np.asarray(output, dtype=np.float32).reshape(-1)
    if output.size == 0:
        raise RuntimeError("Model output is empty.")
    min_v = float(np.min(output))
    max_v = float(np.max(output))
    s = float(np.sum(output))
    if min_v >= 0.0 and max_v <= 1.0 and abs(s - 1.0) <= 1e-2:
        probs = output
    else:
        shifted = output - np.max(output)
        exp = np.exp(np.clip(shifted, -50.0, 50.0))
        probs = exp / np.sum(exp)
    return probs


def run(model_path: Path, image_path: Path):
    if not model_path.exists():
        raise FileNotFoundError(f"MRI model not found: {model_path}")
    if not image_path.exists():
        raise FileNotFoundError(f"MRI image not found: {image_path}")

    try:
        import tensorflow as tf  # noqa: PLC0415, F401
    except Exception as exc:
        raise RuntimeError(
            "TensorFlow is required for MRI Keras inference. Install tensorflow in PYTHON_BIN's environment."
        ) from exc

    model = load_mri_keras_model(model_path)
    batch = preprocess_image_path(image_path)
    raw = np.asarray(model.predict(batch, verbose=0), dtype=np.float64)
    probs = to_probabilities(raw)

    class_id = int(np.argmax(probs))
    confidence = float(probs[class_id])
    label = MRI_LABELS.get(class_id, f"Class_{class_id}")
    mapped = MRI_RISK_MAP.get(class_id, "unknown")

    return {
        "classId": class_id,
        "classLabel": label,
        "confidence": round(confidence, 6),
        "mappedRisk": mapped,
    }


def main():
    parser = argparse.ArgumentParser(description="Run MRI Keras (.keras) inference")
    parser.add_argument("--model", required=True, help="Path to MRI .keras model")
    parser.add_argument("--image", required=True, help="Path to MRI image file")

    args = parser.parse_args()

    try:
        result = run(Path(args.model), Path(args.image))
        print(json.dumps(result))
    except Exception as exc:
        print(json.dumps({"error": str(exc)}), file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
