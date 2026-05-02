# Cognitive screening — methodology & operations (research prototype)

**Decision-support only.** Training data are **synthetic**. This is **not** a medical device and does **not** provide a diagnosis.

See **[CLINICAL_VALIDATION.md](CLINICAL_VALIDATION.md)** for literature-backed rationale of weights, thresholds, and formulas, and what would be required for real clinical validation.

## Fusion (validated-weight summary)

- **Final score:** \(S = 0.40\,C + 0.15\,B + 0.20\,P + 0.25\,(100-M)\)
- **Medical sub-fusion:** \(M = 0.20\,H + 0.30\,R + 0.50\,I\)
- **Cognition `C`:** domain weights plus Crum-1993 age and education adjustment.
- **Classes** from \(S\): Normal (≥78), MCI (65–77), Moderate (50–64), Severe (<50), with ±3 indeterminate buffers at boundaries.
- **Probabilities:** `CalibratedClassifierCV` (isotonic, cv=3) on fusion classifiers.

## API flow

- `POST /api/start-session` → `{ sessionId, createdAt }`
- `POST /api/record-behavior` → append cognitive / behavioral / facial / speech events
- `POST /api/complete-assessment` → final score, risk level, C/B/P/M, medical block, etc.
- `POST /api/predict` — single-shot compatibility endpoint

**UI:** `web/src/cognitive-screening/` (route `/screening`). Start `backend/main.py` and the web dev server as in the root [README](../../README.md).

## Datasets and training (from `backend/`)

Repo root `pyproject.toml` sets `pythonpath = backend` for pytest; use the same layout for `python -m`:

```bash
cd backend
python -m venv .venv
# Windows: .venv\Scripts\activate
pip install -r requirements.txt

python -m cognitive_screening.scripts.generate_datasets
python -m cognitive_screening.ml.train_all
python -m cognitive_screening.ml.evaluate
```

**Run unified API:**

```bash
uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

Open `http://127.0.0.1:8000/docs`.

## MRI slice → medical form (optional)

`POST /api/analyze-mri-image` (multipart `file`).

1. Train/export **`best_mri_model.keras`** (see notebooks under `assets/data/MRI_Data_set/` if present).
2. Place weights at **`cognitive_screening/ml_artifacts/best_mri_model.keras`** or set **`MRI_MODEL_PATH`**.
3. Install **`tensorflow`** for real inference (otherwise a heuristic fallback runs).

## Optional MongoDB

Set **`MONGO_URI`** (and optional **`MONGO_DB`**). With `POST /api/predict`, `"store_session": true` logs the request and result when the client is reachable.

## Artifact locations (this package)

| Path | Purpose |
|------|---------|
| `cognitive_screening/assets/data/*.csv` | Generated tabular datasets |
| `cognitive_screening/assets/models/*.joblib` | Trained regressor and fusion classifiers |
| `cognitive_screening/assets/reports/full_metrics.json` | Metrics bundle |
| `cognitive_screening/assets/reports/roc_*.png` | ROC plots |
| `cognitive_screening/ml_artifacts/best_mri_model.keras` | Optional MRI head |
| `cognitive_screening/ml_artifacts/confusion_yolo/best.pt` | Optional YOLO confusion weights |

## Explainability

- **C, B, P** — `cognitive_screening/data_generation/fusion_formulas.py`
- **M** — predicted by ML from the medical feature vector at inference
- **Class probabilities** — selected fusion model `predict_proba`
