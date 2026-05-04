# Optional ML weights in this folder

## MRI (Keras)

Place **`mri_dementia_model.keras`** (single file or Keras 3 bundle directory) here, or set **`MRI_MODEL_PATH`**.

- Install TensorFlow for inference: `pip install tensorflow-cpu` (or `tensorflow` with GPU).
- Without weights the MRI endpoint uses a **heuristic fallback** (demo only).

## Webcam confusion (YOLO)

Place Ultralytics **`best.pt`** anywhere under this directory (for example `ml_artifacts/my_run/best.pt`), or use:

- `ml_artifacts/best.pt`
- `ml_artifacts/confusion_yolo/best.pt`
- repo `data/confusion_model/best.pt`

Override with env **`CONFUSION_YOLO_PATH`**. Install **`pip install ultralytics`**.
