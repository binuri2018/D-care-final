#!/usr/bin/env python3
import argparse
import json
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import numpy as np
from PIL import Image

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


def load_interpreter(model_path: Path):
    try:
        import tensorflow as tf

        return tf.lite.Interpreter(model_path=str(model_path))
    except Exception:
        try:
            from tflite_runtime.interpreter import Interpreter

            return Interpreter(model_path=str(model_path))
        except Exception as exc:
            raise RuntimeError(
                "Could not import TensorFlow Lite runtime. Install tensorflow or tflite-runtime."
            ) from exc


def preprocess_image(image_path: Path, input_shape):
    target_h = int(input_shape[1])
    target_w = int(input_shape[2])

    image = Image.open(image_path).convert("L")
    image = image.resize((target_w, target_h), Image.BILINEAR)
    grayscale = np.asarray(image).astype(np.float32)
    rgb = np.stack([grayscale, grayscale, grayscale], axis=-1)
    rgb = (rgb / 127.5) - 1.0  # MobileNetV2 preprocessing [-1, 1]
    return np.expand_dims(rgb, axis=0).astype(np.float32)


def to_probabilities(output: np.ndarray) -> np.ndarray:
    output = output.astype(np.float32)
    if output.ndim > 1:
        output = output[0]

    min_v = float(np.min(output))
    max_v = float(np.max(output))
    s = float(np.sum(output))

    if min_v >= 0.0 and max_v <= 1.0 and abs(s - 1.0) <= 1e-2:
        return output

    shifted = output - np.max(output)
    exp = np.exp(shifted)
    return exp / np.sum(exp)


class MriWorkerState:
    def __init__(self, model_path: Path):
        self.model_path = model_path
        self.interpreter = None
        self.input_details = None
        self.output_details = None
        self.ready = False
        self.error = None
        self.load_ms = None

    def load(self):
        started = time.time()
        try:
            if not self.model_path.exists():
                raise FileNotFoundError(f"MRI model not found: {self.model_path}")

            self.interpreter = load_interpreter(self.model_path)
            self.interpreter.allocate_tensors()
            self.input_details = self.interpreter.get_input_details()
            self.output_details = self.interpreter.get_output_details()

            if len(self.input_details) != 1 or len(self.output_details) == 0:
                raise RuntimeError("Unexpected tensor layout in TFLite model.")

            self.ready = True
            self.error = None
        except Exception as exc:
            self.ready = False
            self.error = str(exc)
        finally:
            self.load_ms = int((time.time() - started) * 1000)

    def predict(self, image_path: Path):
        if not self.ready or self.interpreter is None:
            raise RuntimeError(self.error or "Worker is not ready")
        if not image_path.exists():
            raise FileNotFoundError(f"MRI image not found: {image_path}")

        input_info = self.input_details[0]
        input_data = preprocess_image(image_path, input_info["shape"])

        self.interpreter.set_tensor(input_info["index"], input_data)
        self.interpreter.invoke()
        output = self.interpreter.get_tensor(self.output_details[0]["index"])
        probs = to_probabilities(output)

        class_id = int(np.argmax(probs))
        confidence = float(probs[class_id])

        return {
            "classId": class_id,
            "classLabel": MRI_LABELS.get(class_id, "Unknown"),
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
    parser = argparse.ArgumentParser(description="Persistent MRI inference worker")
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
