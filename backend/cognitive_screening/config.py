import os
from pathlib import Path

_PKG = Path(__file__).resolve().parent
_ASSETS = _PKG / "assets"

# Trained .joblib models and fusion artifacts (see ml/train_all.py)
MODEL_DIR = str(_ASSETS / "models")
REPORT_DIR = str(_ASSETS / "reports")

MONGO_URI = os.environ.get("MONGO_URI", "")
MONGO_DB = os.environ.get("MONGO_DB", "neuroscreen_synthetic")

# Repo root (parent of backend/) — used where a global path is required
REPO_ROOT = str(_PKG.parents[1])
