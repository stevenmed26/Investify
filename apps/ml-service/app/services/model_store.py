from __future__ import annotations

import logging
from pathlib import Path

import joblib

logger = logging.getLogger(__name__)

MODEL_DIR  = Path("artifacts")
MODEL_PATH = MODEL_DIR / "current_model.joblib"


def ensure_model_dir() -> None:
    MODEL_DIR.mkdir(parents=True, exist_ok=True)


def save_model_bundle(bundle: dict) -> str:
    ensure_model_dir()
    joblib.dump(bundle, MODEL_PATH)
    size_kb = MODEL_PATH.stat().st_size // 1024
    logger.info("[model-store] model saved path=%s size_kb=%d", MODEL_PATH, size_kb)
    return str(MODEL_PATH)


def load_model_bundle() -> dict | None:
    if not MODEL_PATH.exists():
        logger.debug("[model-store] no model found at path=%s", MODEL_PATH)
        return None
    bundle = joblib.load(MODEL_PATH)
    version = bundle.get("metadata", {}).get("version", "unknown")
    scope   = bundle.get("metadata", {}).get("scope", "unknown")
    logger.debug("[model-store] model loaded version=%s scope=%s path=%s", version, scope, MODEL_PATH)
    return bundle


def model_exists() -> bool:
    return MODEL_PATH.exists()