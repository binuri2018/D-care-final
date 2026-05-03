#!/usr/bin/env python3
import argparse
import json
import sys
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

        interpreter = tf.lite.Interpreter(model_path=str(model_path))
        return interpreter
    except Exception:
        try:
            from tflite_runtime.interpreter import Interpreter

            interpreter = Interpreter(model_path=str(model_path))
            return interpreter
        except Exception as exc:
            raise RuntimeError(
                "Could not import TensorFlow Lite runtime. Install tensorflow or tflite-runtime."
            ) from exc


def preprocess_image(image_path: Path, input_shape):
    # Expected shape is [1, 224, 224, 3]
    target_h = int(input_shape[1])
    target_w = int(input_shape[2])

    image = Image.open(image_path).convert("L")
    image = image.resize((target_w, target_h), Image.BILINEAR)

    grayscale = np.asarray(image).astype(np.float32)
    rgb = np.stack([grayscale, grayscale, grayscale], axis=-1)

    # MobileNetV2 preprocessing: scale to [-1, 1]
    rgb = (rgb / 127.5) - 1.0
    rgb = np.expand_dims(rgb, axis=0).astype(np.float32)
    return rgb


def to_probabilities(output: np.ndarray) -> np.ndarray:
    output = output.astype(np.float32)
    if output.ndim > 1:
        output = output[0]

    if output.size == 0:
        raise RuntimeError("Model output is empty.")

    # If output is already probabilities, keep it; otherwise softmax.
    min_v = float(np.min(output))
    max_v = float(np.max(output))
    s = float(np.sum(output))

    if min_v >= 0.0 and max_v <= 1.0 and abs(s - 1.0) <= 1e-2:
        probs = output
    else:
        shifted = output - np.max(output)
        exp = np.exp(shifted)
        probs = exp / np.sum(exp)

    return probs


def run(model_path: Path, image_path: Path):
    if not model_path.exists():
        raise FileNotFoundError(f"MRI model not found: {model_path}")
    if not image_path.exists():
        raise FileNotFoundError(f"MRI image not found: {image_path}")

    interpreter = load_interpreter(model_path)
    interpreter.allocate_tensors()

    input_details = interpreter.get_input_details()
    output_details = interpreter.get_output_details()

    if len(input_details) != 1 or len(output_details) == 0:
        raise RuntimeError("Unexpected tensor layout in TFLite model.")

    input_info = input_details[0]
    input_data = preprocess_image(image_path, input_info["shape"])

    interpreter.set_tensor(input_info["index"], input_data)
    interpreter.invoke()

    output_data = interpreter.get_tensor(output_details[0]["index"])
    probs = to_probabilities(output_data)

    class_id = int(np.argmax(probs))
    confidence = float(probs[class_id])

    return {
        "classId": class_id,
        "classLabel": MRI_LABELS.get(class_id, "Unknown"),
        "confidence": round(confidence, 6),
        "mappedRisk": MRI_RISK_MAP.get(class_id, "unknown"),
    }


def main():
    parser = argparse.ArgumentParser(description="Run MRI TFLite inference")
    parser.add_argument("--model", required=True, help="Path to MRI .tflite model")
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