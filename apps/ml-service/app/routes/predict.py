from fastapi import APIRouter
from app.schemas import PredictRequest, PredictResponse

router = APIRouter()


@router.post("/predict", response_model=PredictResponse)
def predict(payload: PredictRequest):
    symbol = payload.symbol.upper()

    return PredictResponse(
        symbol=symbol,
        predicted_direction="bullish",
        predicted_return_pct=2.14,
        confidence_score=0.74,
        recommendation="buy",
        explanation={
            "signals": [
                "Price is above 20-day moving average",
                "Positive 10-day momentum",
                "RSI remains below overbought threshold",
            ],
            "risk_factors": [
                "20-day volatility is elevated"
            ],
        },
        model_version="v0.1.0",
    )