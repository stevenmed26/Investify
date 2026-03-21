from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException, Query

from app.services.trainer import train_model

logger = logging.getLogger(__name__)
router = APIRouter()


@router.post("/train")
def train(horizon_days: int = Query(default=5, ge=1, le=60)):
    """
    Train the shared prediction model on ALL available ticker data.

    The symbol query parameter has been removed. A model trained on a single
    ticker has ~100 rows, no cross-ticker signal, and will overfit immediately.
    The correct flow is:
      1. Seed history for all tickers  (batch ingest)
      2. Backfill features for all tickers
      3. Train once on everything  ← this endpoint
      4. Predict for any individual ticker using the shared model
    """
    logger.info("[train-route] POST /train horizon_days=%d", horizon_days)

    try:
        result = train_model(horizon_days=horizon_days)

        logger.info(
            "[train-route] training succeeded accuracy=%.4f rows=%d "
            "train_rows=%d test_rows=%d tickers=%s",
            result.accuracy, result.rows, result.train_rows,
            result.test_rows, result.tickers,
        )

        return {
            "rows":        result.rows,
            "train_rows":  result.train_rows,
            "test_rows":   result.test_rows,
            "accuracy":    result.accuracy,
            "labels":      result.labels,
            "tickers":     result.tickers,
            "model_path":  result.model_path,
        }

    except ValueError as exc:
        logger.warning("[train-route] training rejected: %s", exc)
        raise HTTPException(status_code=400, detail=str(exc))

    except Exception as exc:
        logger.exception("[train-route] unexpected training error: %s", exc)
        raise HTTPException(status_code=500, detail=f"Unexpected training error: {exc}")