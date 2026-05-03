#!/usr/bin/env python3
import argparse
import json
import sys
from pathlib import Path

import joblib
import numpy as np

FEATURE_ORDER = [
    "Age",
    "BMI",
    "EducationLevel",
    "MMSE",
    "FunctionalAssessment",
    "MemoryComplaints",
    "Forgetfulness",
]


def normalize_features(payload: dict) -> np.ndarray:
    values = []
    for key in FEATURE_ORDER:
        if key not in payload:
            raise ValueError(f"Missing required feature: {key}")
        values.append(float(payload[key]))
    return np.array(values, dtype=np.float32).reshape(1, -1)


def run(model_path: Path, payload: dict):
    if not model_path.exists():
        raise FileNotFoundError(f"Clinical model not found: {model_path}")

    model = joblib.load(model_path)
    x = normalize_features(payload)

    if hasattr(model, "predict_proba"):
        proba = float(model.predict_proba(x)[0][1])
    else:
        pred = model.predict(x)
        proba = float(pred[0])

    proba = float(max(0.0, min(1.0, proba)))
    return {"probability": round(proba, 6)}


def main():
    parser = argparse.ArgumentParser(description="Run clinical model inference")
    parser.add_argument("--model", required=True, help="Path to clinical .joblib model")

    args = parser.parse_args()

    try:
        raw = sys.stdin.read().strip()
        if not raw:
            raise ValueError("Missing JSON payload on stdin")

        payload = json.loads(raw)
        if not isinstance(payload, dict):
            raise ValueError("Payload must be a JSON object")

        result = run(Path(args.model), payload)
        print(json.dumps(result))
    except Exception as exc:
        print(json.dumps({"error": str(exc)}), file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()