from __future__ import annotations

from fastapi import APIRouter, Depends

from app.security import verify_internal_token
from app.services.model_store import load_model_bundle, model_exists


router = APIRouter()


@router.get("/models/current")
def get_current_model(_verified: None = Depends(verify_internal_token)):
    if not model_exists():
        return {"exists": False}

    bundle = load_model_bundle()
    if not bundle:
        return {"exists": False}

    return {
        "exists": True,
        "metadata": bundle.get("metadata", {}),
        "metrics": bundle.get("metrics", {}),
        "labels": bundle.get("labels", []),
        "features": bundle.get("features", []),
        "horizon_days": bundle.get("horizon_days"),
    }
