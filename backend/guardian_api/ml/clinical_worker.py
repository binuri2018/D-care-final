#!/usr/bin/env python3
import argparse
import json
import re
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
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


def _parse_first_float(text: str):
    if not isinstance(text, str):
        return None
    match = re.search(r"([0-9]*\.?[0-9]+)", text)
    if not match:
        return None
    return float(match.group(1))


class ClinicalWorkerState:
    def __init__(self, model_path: Path, thresholds_path: Path, metrics_path: Path):
        self.model_path = model_path
        self.thresholds_path = thresholds_path
        self.metrics_path = metrics_path

        self.model = None
        self.thresholds = {"lowMax": 0.3, "mediumMax": 0.7}
        self.metrics = None

        self.ready = False
        self.error = None
        self.load_ms = None

    def load(self):
        start = time.time()
        try:
            if not self.model_path.exists():
                raise FileNotFoundError(f"Clinical model not found: {self.model_path}")

            self.model = joblib.load(self.model_path)

            if self.thresholds_path.exists():
                raw = json.loads(self.thresholds_path.read_text(encoding="utf-8"))
                risk_mapping = raw.get("risk_mapping", {})

                low_max = _parse_first_float(risk_mapping.get("low"))
                medium_expr = risk_mapping.get("medium")
                medium_max = None
                if isinstance(medium_expr, str):
                    nums = re.findall(r"([0-9]*\.?[0-9]+)", medium_expr)
                    if nums:
                        medium_max = float(nums[-1])

                if (
                    low_max is not None
                    and medium_max is not None
                    and low_max < medium_max
                ):
                    self.thresholds = {"lowMax": low_max, "mediumMax": medium_max}

            if self.metrics_path.exists():
                self.metrics = json.loads(self.metrics_path.read_text(encoding="utf-8"))

            self.ready = True
            self.error = None
        except Exception as exc:
            self.ready = False
            self.error = str(exc)
        finally:
            self.load_ms = int((time.time() - start) * 1000)

    def map_risk(self, probability: float):
        if probability < self.thresholds["lowMax"]:
            return "low"
        if probability <= self.thresholds["mediumMax"]:
            return "medium"
        return "high"

    def predict(self, payload: dict):
        if not self.ready or self.model is None:
            raise RuntimeError(self.error or "Worker is not ready")

        values = []
        for key in FEATURE_ORDER:
            if key not in payload:
                raise ValueError(f"Missing feature: {key}")
            values.append(float(payload[key]))

        x = np.array(values, dtype=np.float32).reshape(1, -1)
        if hasattr(self.model, "predict_proba"):
            probability = float(self.model.predict_proba(x)[0][1])
        else:
            probability = float(self.model.predict(x)[0])

        probability = float(max(0.0, min(1.0, probability)))
        return {
            "probability": round(probability, 6),
            "mappedRisk": self.map_risk(probability),
            "featureOrder": FEATURE_ORDER,
            "thresholds": self.thresholds,
        }


class WorkerHandler(BaseHTTPRequestHandler):
    state: ClinicalWorkerState = None

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
                    "thresholds": self.state.thresholds,
                    "metricsLoaded": self.state.metrics is not None,
                },
            )
            return

        if self.path == "/metrics":
            if self.state.metrics is None:
                self._json(404, {"message": "Metrics not loaded"})
            else:
                self._json(200, self.state.metrics)
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
            if not isinstance(payload, dict):
                raise ValueError("Payload must be a JSON object")

            result = self.state.predict(payload)
            self._json(200, result)
        except Exception as exc:
            self._json(400, {"message": str(exc)})

    def log_message(self, fmt, *args):
        print(f"[clinical-worker] {self.address_string()} - {fmt % args}")


def main():
    parser = argparse.ArgumentParser(description="Persistent clinical inference worker")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8051)
    parser.add_argument("--model", required=True)
    parser.add_argument("--thresholds", required=True)
    parser.add_argument("--metrics", required=True)
    args = parser.parse_args()

    state = ClinicalWorkerState(
        model_path=Path(args.model),
        thresholds_path=Path(args.thresholds),
        metrics_path=Path(args.metrics),
    )
    state.load()

    print("[clinical-worker] startup diagnostics:")
    print(f"  model: {state.model_path}")
    print(f"  thresholds: {state.thresholds_path}")
    print(f"  metrics: {state.metrics_path}")
    print(f"  ready: {state.ready}")
    print(f"  loadMs: {state.load_ms}")
    if state.error:
        print(f"  error: {state.error}")

    WorkerHandler.state = state
    server = ThreadingHTTPServer((args.host, args.port), WorkerHandler)
    print(f"[clinical-worker] listening on http://{args.host}:{args.port}")
    server.serve_forever()


if __name__ == "__main__":
    main()