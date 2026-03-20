from fastapi import APIRouter, HTTPException, Query
from app.services.trainer import train_model
from app.services.model_store import load_model_bundle, model_exists

router = APIRouter()


@router.post("/train")
def train(
    symbol: str | None = Query(default=None),
    horizon_days: int = Query(default=5, ge=1, le=30),
):
    try:
        result = train_model(symbol=symbol, horizon_days=horizon_days)
        return {
            "status": "ok",
            "rows": result.rows,
            "train_rows": result.train_rows,
            "test_rows": result.test_rows,
            "accuracy": result.accuracy,
            "labels": result.labels,
            "model_path": result.model_path,
        }
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/models/current")
def current_model():
    if not model_exists():
        return {
            "exists": False,
            "message": "No trained model artifact found",
        }

    bundle = load_model_bundle()
    return {
        "exists": True,
        "metadata": bundle.get("metadata", {}),
        "metrics": bundle.get("metrics", {}),
        "features": bundle.get("features", []),
        "labels": bundle.get("labels", []),
        "horizon_days": bundle.get("horizon_days"),
    }