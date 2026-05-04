#!/usr/bin/env python3
import argparse
import json
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
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
        return output
    shifted = output - np.max(output)
    exp = np.exp(np.clip(shifted, -50.0, 50.0))
    return exp / np.sum(exp)


class MriWorkerState:
    def __init__(self, model_path: Path):
        self.model_path = model_path
        self.model = None
        self.ready = False
        self.error = None
        self.load_ms = None

    def load(self):
        started = time.time()
        try:
            if not self.model_path.exists():
                raise FileNotFoundError(f"MRI model not found: {self.model_path}")
            self.model = load_mri_keras_model(self.model_path)
            self.ready = True
            self.error = None
        except Exception as exc:
            self.ready = False
            self.model = None
            self.error = str(exc)
        finally:
            self.load_ms = int((time.time() - started) * 1000)

    def predict(self, image_path: Path):
        if not self.ready or self.model is None:
            raise RuntimeError(self.error or "Worker is not ready")
        if not image_path.exists():
            raise FileNotFoundError(f"MRI image not found: {image_path}")

        batch = preprocess_image_path(image_path)
        raw = np.asarray(self.model.predict(batch, verbose=0), dtype=np.float64)
        probs = to_probabilities(raw)

        class_id = int(np.argmax(probs))
        confidence = float(probs[class_id])

        return {
            "classId": class_id,
            "classLabel": MRI_LABELS.get(class_id, f"Class_{class_id}"),
            "confidence": round(confidence, 6),
            "mappedRisk": MRI_RISK_MAP.get(class_id, "unknown"),
        }


class WorkerHandler(BaseHTTPRequestHandler):
    state: MriWorkerState = None

    def _json(self, status, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/health":
            self._json(
                200,
                {
                    "ready": bool(self.state.ready),
                    "loadMs": self.state.load_ms,
                    "error": self.state.error,
                },
            )
            return
        self._json(404, {"message": "Not found"})

    def do_POST(self):
        if self.path != "/predict":
            self._json(404, {"message": "Not found"})
            return

        try:
            content_length = int(self.headers.get("Content-Length", "0"))
            raw = self.rfile.read(content_length).decode("utf-8") if content_length > 0 else "{}"
            payload = json.loads(raw)
            image_path_raw = payload.get("imagePath")
            if not image_path_raw:
                raise ValueError("imagePath is required")

            result = self.state.predict(Path(image_path_raw))
            self._json(200, result)
        except Exception as exc:
            self._json(400, {"message": str(exc)})

    def log_message(self, fmt, *args):
        print(f"[mri-worker] {self.address_string()} - {fmt % args}")


def main():
    parser = argparse.ArgumentParser(description="Persistent MRI Keras inference worker")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8052)
    parser.add_argument("--model", required=True)
    args = parser.parse_args()

    state = MriWorkerState(Path(args.model))
    state.load()

    print("[mri-worker] startup diagnostics:")
    print(f"  model: {state.model_path}")
    print(f"  ready: {state.ready}")
    print(f"  loadMs: {state.load_ms}")
    if state.error:
        print(f"  error: {state.error}")

    WorkerHandler.state = state
    server = ThreadingHTTPServer((args.host, args.port), WorkerHandler)
    print(f"[mri-worker] listening on http://{args.host}:{args.port}")
    server.serve_forever()


if __name__ == "__main__":
    main()
