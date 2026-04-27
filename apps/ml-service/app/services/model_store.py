from __future__ import annotations

import logging
from pathlib import Path

import joblib

logger = logging.getLogger(__name__)

MODEL_DIR = Path("artifacts")
CURRENT_MODEL_PATH = MODEL_DIR / "current_model.joblib"


def ensure_model_dir() -> None:
    MODEL_DIR.mkdir(parents=True, exist_ok=True)


def save_model_bundle(bundle: dict) -> str:
    ensure_model_dir()
    horizon_days = int(bundle["horizon_days"])
    model_path = get_model_path(horizon_days)
    joblib.dump(bundle, model_path)
    joblib.dump(bundle, CURRENT_MODEL_PATH)
    size_kb = model_path.stat().st_size // 1024
    logger.info("[model-store] model saved path=%s size_kb=%d", model_path, size_kb)
    return str(model_path)


def load_model_bundle(horizon_days: int | None = None) -> dict | None:
    model_path = get_model_path(horizon_days) if horizon_days is not None else CURRENT_MODEL_PATH
    if not model_path.exists():
        logger.debug("[model-store] no model found at path=%s", model_path)
        return None
    bundle = joblib.load(model_path)
    version = bundle.get("metadata", {}).get("version", "unknown")
    scope = bundle.get("metadata", {}).get("scope", "unknown")
    logger.debug("[model-store] model loaded version=%s scope=%s path=%s", version, scope, model_path)
    return bundle


def model_exists(horizon_days: int | None = None) -> bool:
    model_path = get_model_path(horizon_days) if horizon_days is not None else CURRENT_MODEL_PATH
    return model_path.exists()


def get_model_path(horizon_days: int) -> Path:
    return MODEL_DIR / f"current_model_h{int(horizon_days)}.joblib"
