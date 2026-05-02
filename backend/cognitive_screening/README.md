# Cognitive screening (subsystem)

Research-oriented **decision-support** APIs (not a medical device). Mounted on the Memory Aid backend at the same routes as before (`/api/predict`, `/api/start-session`, etc.).

## Layout

| Path | Purpose |
|------|---------|
| `routers/` | FastAPI routers |
| `services/` | Inference, session store, MRI/confusion helpers |
| `data_generation/` | Synthetic dataset generators |
| `ml/` | Training & evaluation (`train_all`, `evaluate`) |
| `scripts/` | `generate_datasets` |
| `assets/models/` | Trained `.joblib` (after `python -m cognitive_screening.ml.train_all`) |
| `assets/data/` | CSVs from `generate_datasets` + optional research data |
| `assets/reports/` | `full_metrics.json`, plots |
| `ml_artifacts/` | Optional `best_mri_model.keras`, YOLO confusion weights |

See **RESEARCH.md** and **CLINICAL_VALIDATION.md** for methodology and training notes.

## Commands (from `backend/`, venv with `requirements.txt`)

```bash
python -m cognitive_screening.scripts.generate_datasets
python -m cognitive_screening.ml.train_all
python -m cognitive_screening.ml.evaluate
```

The main app loads this package from `main.py`; no separate repo folder is required.
