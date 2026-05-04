"""
Load MRI Keras checkpoints for cognitive screening and Dementia Guardian.

Handles:
- Keras 3 **directory** bundles whose name ends in ``.keras`` (Keras otherwise tries to open them as a zip).
- ``quantization_config`` entries in saved JSON (newer Keras) when the runtime Keras does not accept them.
"""

from __future__ import annotations

import json
import shutil
import tempfile
from pathlib import Path
from typing import Any


def _strip_quantization_config(obj: Any) -> None:
    """Drop keys older Keras Dense layers do not accept."""
    if isinstance(obj, dict):
        obj.pop("quantization_config", None)
        for v in obj.values():
            _strip_quantization_config(v)
    elif isinstance(obj, list):
        for v in obj:
            _strip_quantization_config(v)


def load_mri_keras_model(model_path: Path) -> Any:
    """Load a ``.keras`` zip or an on-disk Keras 3 bundle directory."""
    import tensorflow as tf  # noqa: PLC0415

    p = Path(model_path).resolve()

    if p.is_dir() and (p / "config.json").is_file():
        data = json.loads((p / "config.json").read_text(encoding="utf-8"))
        _strip_quantization_config(data)
        staging = Path(tempfile.mkdtemp(prefix="mri_keras_"))
        try:
            (staging / "config.json").write_text(json.dumps(data), encoding="utf-8")
            for fname in ("model.weights.h5", "metadata.json"):
                src = p / fname
                if src.is_file():
                    shutil.copy2(src, staging / fname)
            assets = p / "assets"
            if assets.is_dir():
                shutil.copytree(assets, staging / "assets")
            from keras.src.saving import saving_lib  # noqa: PLC0415

            return saving_lib._load_model_from_dir(
                str(staging), custom_objects=None, compile=False, safe_mode=True
            )
        finally:
            shutil.rmtree(staging, ignore_errors=True)

    return tf.keras.models.load_model(str(p), compile=False)
