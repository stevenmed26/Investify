from pydantic import BaseModel, Field
from typing import Literal


class PredictRequest(BaseModel):
    symbol: str = Field(min_length=1)
    horizon_days: int = Field(default=5, ge=1, le=90)


class PredictResponse(BaseModel):
    symbol: str
    predicted_direction: Literal["bullish", "neutral", "bearish"]
    predicted_return_pct: float
    confidence_score: float
    recommendation: Literal["buy", "sell", "wait"]
    explanation: dict
    model_version: str