from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query

from app.services.trainer import train_model


router = APIRouter()


@router.post("/train")
def train(
    symbol: str | None = Query(default=None),
    horizon_days: int = Query(default=5, ge=1, le=60),
):
    try:
        result = train_model(symbol=symbol, horizon_days=horizon_days)
        return {
            "rows": result.rows,
            "train_rows": result.train_rows,
            "test_rows": result.test_rows,
            "accuracy": result.accuracy,
            "labels": result.labels,
            "model_path": result.model_path,
        }
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Unexpected training error: {exc}")