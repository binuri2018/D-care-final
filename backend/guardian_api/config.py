import sys
from pathlib import Path

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

PACKAGE_ROOT = Path(__file__).resolve().parent
BACKEND_ROOT = PACKAGE_ROOT.parent
REPO_ROOT = BACKEND_ROOT.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(
            str(BACKEND_ROOT / ".env"),
            str(BACKEND_ROOT / "env"),
        ),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    port: int = 4000
    mongo_uri: str = ""
    jwt_secret: str = "dev_only_change_me_in_dotenv_32chars!!"
    jwt_expires_in: str = "7d"
    bcrypt_rounds: int = 10

    python_bin: str = sys.executable
    mri_tflite_path: str = ""
    clinical_joblib_path: str = ""

    risk_mri_weight: float = 0.6
    risk_clinical_weight: float = 0.4
    heartbeat_stale_minutes: int = 10

    ollama_base_url: str = "https://api.openai.com/v1"
    ollama_api_key: str = ""
    ollama_model: str = "gpt-4o-mini"

    reports_dir: str = "data/reports"

    @field_validator("python_bin", mode="after")
    @classmethod
    def _python_bin_nonempty(cls, v: str) -> str:
        v = (v or "").strip()
        return v or sys.executable


def resolve_path(base: Path, raw: str, default_rel: str) -> Path:
    p = (raw or "").strip()
    if not p:
        return (base / default_rel).resolve()
    path = Path(p)
    if path.is_absolute():
        return path.resolve()
    return (base / path).resolve()


def _default_mri_model_relative() -> str:
    """Prefer on-disk Keras bundle or single file under cognitive_screening/ml_artifacts/."""
    art = REPO_ROOT / "backend" / "cognitive_screening" / "ml_artifacts"
    for name in ("mri_dementia_model.keras", "mri_dementia_model .keras"):
        p = art / name
        if p.is_file() or p.is_dir():
            rel = p.relative_to(REPO_ROOT)
            return rel.as_posix()
    return "backend/cognitive_screening/ml_artifacts/mri_dementia_model.keras"


def settings_paths(settings: Settings, backend_root: Path) -> tuple[Path, Path]:
    _ = backend_root
    rel_mri = _default_mri_model_relative()
    rel_clin = "Flutter_App-Dimentia-master/Clinical Model/clinical_xgb_model.joblib"
    mri = resolve_path(REPO_ROOT, settings.mri_tflite_path, rel_mri)
    clin = resolve_path(REPO_ROOT, settings.clinical_joblib_path, rel_clin)
    return mri, clin
