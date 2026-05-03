from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

# python_backend/ (parent of app/)
BACKEND_ROOT = Path(__file__).resolve().parent.parent


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
    # HS256: use at least 32 bytes in production (PyJWT warns below that length).
    jwt_secret: str = "dev_only_change_me_in_dotenv_32chars!!"
    jwt_expires_in: str = "7d"
    bcrypt_rounds: int = 10

    python_bin: str = "python"
    mri_tflite_path: str = "../MRI_Data_set/mri_mobilenetv2_fp16.tflite"
    clinical_joblib_path: str = "../Clinical Model/clinical_xgb_model.joblib"

    risk_mri_weight: float = 0.6
    risk_clinical_weight: float = 0.4
    heartbeat_stale_minutes: int = 10

    ollama_base_url: str = "https://api.openai.com/v1"
    ollama_api_key: str = ""
    ollama_model: str = "gpt-4o-mini"

    reports_dir: str = "data/reports"


def resolve_path(base: Path, raw: str, default_rel: str) -> Path:
    p = (raw or "").strip()
    if not p:
        return (base / default_rel).resolve()
    path = Path(p)
    if path.is_absolute():
        return path.resolve()
    return (base / path).resolve()


def settings_paths(settings: Settings, backend_root: Path) -> tuple[Path, Path]:
    mri = resolve_path(backend_root, settings.mri_tflite_path, "../MRI_Data_set/mri_mobilenetv2_fp16.tflite")
    clin = resolve_path(backend_root, settings.clinical_joblib_path, "../Clinical Model/clinical_xgb_model.joblib")
    return mri, clin
