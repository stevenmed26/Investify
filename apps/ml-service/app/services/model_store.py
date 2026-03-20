from __future__ import annotations

from pathlib import Path
import joblib

MODEL_DIR = Path("artifacts")
MODEL_PATH = MODEL_DIR / "current_model.joblib"


def ensure_model_dir() -> None:
    MODEL_DIR.mkdir(parents=True, exist_ok=True)


def save_model_bundle(bundle: dict) -> str:
    ensure_model_dir()
    joblib.dump(bundle, MODEL_PATH)
    return str(MODEL_PATH)


def load_model_bundle() -> dict | None:
    if not MODEL_PATH.exists():
        return None
    return joblib.load(MODEL_PATH)


def model_exists() -> bool:
    return MODEL_PATH.exists()