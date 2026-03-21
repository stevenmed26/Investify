from __future__ import annotations

import logging

from fastapi import APIRouter

from app.schemas import PredictRequest, PredictResponse
from app.db import get_connection
from app.services.predictor import predict_with_trained_model

logger = logging.getLogger(__name__)
router = APIRouter()


def build_rule_based_prediction(symbol: str) -> PredictResponse | None:
    """
    Rule-based fallback when no trained model exists.
    Returns None if no technical features have been backfilled for the symbol
    (rather than raising 404, which causes the Go API to return 502).
    """
    logger.info("[predict-route] using rule-based fallback symbol=%s", symbol)

    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT
                    tf.trading_date,
                    tf.sma_20, tf.sma_50,
                    tf.ema_12, tf.ema_26,
                    tf.rsi_14, tf.macd,
                    tf.momentum_5d, tf.momentum_20d,
                    tf.volatility_20d,
                    hp.close
                FROM technical_features tf
                JOIN tickers t ON t.id = tf.ticker_id
                LEFT JOIN historical_prices hp
                  ON hp.ticker_id = tf.ticker_id
                 AND hp.trading_date = tf.trading_date
                WHERE t.symbol = %s
                ORDER BY tf.trading_date DESC
                LIMIT 1
                """,
                (symbol,),
            )
            row = cur.fetchone()

    if not row:
        logger.warning(
            "[predict-route] no technical features found symbol=%s — "
            "returning no-data response (run backfill first)",
            symbol,
        )
        return None

    logger.debug("[predict-route] rule-based feature row symbol=%s date=%s", symbol, row.get("trading_date"))

    score = 0.0
    signals:      list[str] = []
    risk_factors: list[str] = []

    close         = row["close"]
    sma_20        = row["sma_20"]
    sma_50        = row["sma_50"]
    ema_12        = row["ema_12"]
    ema_26        = row["ema_26"]
    rsi_14        = row["rsi_14"]
    macd          = row["macd"]
    momentum_5d   = row["momentum_5d"]
    momentum_20d  = row["momentum_20d"]
    volatility_20d = row["volatility_20d"]

    if close is not None and sma_20 is not None and close > sma_20:
        score += 0.18; signals.append("Price is above 20-day moving average")
    else:
        score -= 0.18; risk_factors.append("Price is below 20-day moving average")

    if close is not None and sma_50 is not None and close > sma_50:
        score += 0.18; signals.append("Price is above 50-day moving average")
    else:
        score -= 0.18; risk_factors.append("Price is below 50-day moving average")

    if ema_12 is not None and ema_26 is not None and ema_12 > ema_26:
        score += 0.14; signals.append("EMA 12 is above EMA 26")
    else:
        score -= 0.14; risk_factors.append("EMA 12 is below EMA 26")

    if macd is not None and macd > 0:
        score += 0.12; signals.append("MACD is positive")
    elif macd is not None:
        score -= 0.12; risk_factors.append("MACD is negative")

    if momentum_5d is not None and momentum_5d > 0:
        score += 0.10; signals.append("Positive 5-day momentum")
    elif momentum_5d is not None:
        score -= 0.10; risk_factors.append("Negative 5-day momentum")

    if momentum_20d is not None and momentum_20d > 0:
        score += 0.12; signals.append("Positive 20-day momentum")
    elif momentum_20d is not None:
        score -= 0.12; risk_factors.append("Negative 20-day momentum")

    if rsi_14 is not None:
        if 45 <= rsi_14 <= 65:
            score += 0.08; signals.append("RSI is in a stable bullish range")
        elif rsi_14 > 75:
            score -= 0.08; risk_factors.append("RSI suggests overbought conditions")
        elif rsi_14 < 30:
            risk_factors.append("RSI suggests oversold conditions")

    if volatility_20d is not None:
        if volatility_20d > 45:
            score -= 0.10; risk_factors.append("20-day volatility is elevated")
        elif volatility_20d < 25:
            score += 0.05; signals.append("20-day volatility is relatively contained")

    normalized = max(min((score + 1.0) / 2.0, 1.0), 0.0)

    if score >= 0.25:
        direction      = "bullish"
        recommendation = "buy" if normalized >= 0.65 else "wait"
    elif score <= -0.25:
        direction      = "bearish"
        recommendation = "sell" if normalized <= 0.35 else "wait"
    else:
        direction      = "neutral"
        recommendation = "wait"

    confidence           = normalized if direction == "bullish" else (1.0 - normalized if direction == "bearish" else 0.55)
    predicted_return_pct = round(score * 4.0, 2)
    confidence           = round(max(min(confidence, 0.95), 0.51 if direction == "neutral" else 0.05), 4)

    logger.info(
        "[predict-route] rule-based result symbol=%s direction=%s "
        "confidence=%.4f recommendation=%s score=%.4f",
        symbol, direction, confidence, recommendation, score,
    )

    return PredictResponse(
        symbol=symbol,
        predicted_direction=direction,
        predicted_return_pct=predicted_return_pct,
        confidence_score=confidence,
        recommendation=recommendation,
        explanation={"signals": signals, "risk_factors": risk_factors},
        model_version="rules-v0.2.0",
    )


@router.post("/predict", response_model=PredictResponse)
def predict(payload: PredictRequest):
    symbol = payload.symbol.upper()
    logger.info("[predict-route] POST /predict symbol=%s horizon_days=%d", symbol, payload.horizon_days)

    trained = predict_with_trained_model(symbol)
    if trained is not None:
        return trained

    rule_based = build_rule_based_prediction(symbol)
    if rule_based is not None:
        return rule_based

    # No features backfilled yet — return a valid neutral response rather than
    # 404 (which would cause the Go API to return 502 Bad Gateway upstream).
    logger.warning("[predict-route] no data at all for symbol=%s — returning no-data sentinel", symbol)
    return PredictResponse(
        symbol=symbol,
        predicted_direction="neutral",
        predicted_return_pct=0.0,
        confidence_score=0.5,
        recommendation="wait",
        explanation={
            "signals": [],
            "risk_factors": ["No technical features found. Seed history and generate features first."],
        },
        model_version="no-data-v0",
    )