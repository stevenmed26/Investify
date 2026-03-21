from __future__ import annotations

import logging
from typing import Any

import numpy as np

from app.schemas import PredictResponse
from app.services.dataset import load_latest_feature_row
from app.services.model_store import load_model_bundle

logger = logging.getLogger(__name__)


def predict_with_trained_model(symbol: str) -> PredictResponse | None:
    bundle = load_model_bundle()
    if not bundle:
        logger.debug("[predictor] no trained model on disk — falling back to rules symbol=%s", symbol)
        return None

    model    = bundle["model"]
    features = bundle["features"]
    scope    = bundle.get("metadata", {}).get("scope", "?")
    version  = bundle.get("metadata", {}).get("version", "ml-v0.4.0")

    logger.info("[predictor] using trained model version=%s scope=%s symbol=%s", version, scope, symbol)

    df = load_latest_feature_row(symbol)
    if df.empty:
        logger.warning(
            "[predictor] no feature row available for symbol=%s — "
            "falling back to rules (run backfill first)",
            symbol,
        )
        return None

    # Guard against a model trained with a different feature set (e.g. after
    # a feature engineering change) being used without retraining.
    missing = [f for f in features if f not in df.columns]
    if missing:
        logger.error(
            "[predictor] model feature mismatch symbol=%s missing_cols=%s — "
            "retrain the model",
            symbol, missing,
        )
        return None

    X = df[features].copy()

    probabilities   = model.predict_proba(X)[0]
    classes         = model.classes_
    prob_map        = {cls: float(prob) for cls, prob in zip(classes, probabilities)}
    predicted_class = str(model.predict(X)[0])
    confidence      = round(float(np.max(probabilities)), 4)

    predicted_return_pct = 0.0
    if predicted_class == "bullish":
        predicted_return_pct = round(confidence * 4.0, 2)
    elif predicted_class == "bearish":
        predicted_return_pct = round(-confidence * 4.0, 2)

    recommendation = "wait"
    if predicted_class == "bullish" and confidence >= 0.60:
        recommendation = "buy"
    elif predicted_class == "bearish" and confidence >= 0.60:
        recommendation = "sell"

    logger.info(
        "[predictor] prediction symbol=%s direction=%s confidence=%.4f "
        "return_pct=%.2f recommendation=%s version=%s",
        symbol, predicted_class, confidence, predicted_return_pct, recommendation, version,
    )
    logger.debug("[predictor] class probabilities symbol=%s probs=%s", symbol, prob_map)

    explanation = build_explanation(df.iloc[0].to_dict(), prob_map)

    return PredictResponse(
        symbol=symbol.upper(),
        predicted_direction=predicted_class,
        predicted_return_pct=predicted_return_pct,
        confidence_score=confidence,
        recommendation=recommendation,
        explanation=explanation,
        model_version=version,
    )


def build_explanation(row: dict[str, Any], prob_map: dict[str, float]) -> dict:
    signals:      list[str] = []
    risk_factors: list[str] = []

    close         = row.get("close")
    sma_20        = row.get("sma_20")
    sma_50        = row.get("sma_50")
    ema_12        = row.get("ema_12")
    ema_26        = row.get("ema_26")
    rsi_14        = row.get("rsi_14")
    macd          = row.get("macd")
    momentum_5d   = row.get("momentum_5d")
    momentum_20d  = row.get("momentum_20d")
    volatility_20d = row.get("volatility_20d")

    if close is not None and sma_20 is not None and close > sma_20:
        signals.append("Price is above 20-day moving average")
    else:
        risk_factors.append("Price is below 20-day moving average")

    if close is not None and sma_50 is not None and close > sma_50:
        signals.append("Price is above 50-day moving average")
    else:
        risk_factors.append("Price is below 50-day moving average")

    if ema_12 is not None and ema_26 is not None and ema_12 > ema_26:
        signals.append("EMA 12 is above EMA 26")
    else:
        risk_factors.append("EMA 12 is below EMA 26")

    if macd is not None and macd > 0:
        signals.append("MACD is positive")
    elif macd is not None:
        risk_factors.append("MACD is negative")

    if momentum_5d is not None and momentum_5d > 0:
        signals.append("Positive 5-day momentum")
    elif momentum_5d is not None:
        risk_factors.append("Negative 5-day momentum")

    if momentum_20d is not None and momentum_20d > 0:
        signals.append("Positive 20-day momentum")
    elif momentum_20d is not None:
        risk_factors.append("Negative 20-day momentum")

    if rsi_14 is not None:
        if rsi_14 > 75:
            risk_factors.append("RSI suggests overbought conditions")
        elif rsi_14 < 30:
            risk_factors.append("RSI suggests oversold conditions")

    if volatility_20d is not None and volatility_20d > 45:
        risk_factors.append("20-day volatility is elevated")

    return {
        "signals":       signals,
        "risk_factors":  risk_factors,
        "class_probabilities": {
            "bullish": round(prob_map.get("bullish", 0.0), 4),
            "neutral": round(prob_map.get("neutral", 0.0), 4),
            "bearish": round(prob_map.get("bearish", 0.0), 4),
        },
    }