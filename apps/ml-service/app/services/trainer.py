from __future__ import annotations

from dataclasses import dataclass
import numpy as np
from sklearn.compose import ColumnTransformer
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, classification_report
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

from app.services.dataset import load_training_dataframe
from app.services.model_store import save_model_bundle


MODEL_FEATURES = [
    "sma_20",
    "sma_50",
    "ema_12",
    "ema_26",
    "rsi_14",
    "macd",
    "momentum_5d",
    "momentum_20d",
    "volatility_20d",
    "close",
    "price_vs_sma20",
    "price_vs_sma50",
    "ema_gap",
]


@dataclass
class TrainResult:
    rows: int
    train_rows: int
    test_rows: int
    accuracy: float
    labels: list[str]
    model_path: str


def train_model(symbol: str | None = None, horizon_days: int = 5) -> TrainResult:
    df = load_training_dataframe(symbol=symbol, horizon_days=horizon_days)
    if df.empty:
        raise ValueError("No training data available. Seed history and generate features first.")

    X = df[MODEL_FEATURES].copy()
    y = df["label"].copy()

    # Time-based split
    split_idx = int(len(df) * 0.8)
    if split_idx <= 0 or split_idx >= len(df):
        raise ValueError("Not enough rows to split training and test sets.")

    X_train = X.iloc[:split_idx]
    y_train = y.iloc[:split_idx]
    X_test = X.iloc[split_idx:]
    y_test = y.iloc[split_idx:]

    numeric_transformer = Pipeline(
        steps=[
            ("imputer", SimpleImputer(strategy="median")),
            ("scaler", StandardScaler()),
        ]
    )

    preprocessor = ColumnTransformer(
        transformers=[
            ("num", numeric_transformer, MODEL_FEATURES),
        ]
    )

    clf = Pipeline(
        steps=[
            ("preprocessor", preprocessor),
            (
                "classifier",
                LogisticRegression(
                    max_iter=1000,
                    multi_class="multinomial",
                    class_weight="balanced",
                    random_state=42,
                ),
            ),
        ]
    )

    clf.fit(X_train, y_train)
    predictions = clf.predict(X_test)
    accuracy = float(accuracy_score(y_test, predictions))

    labels = sorted(list(np.unique(y)))
    report = classification_report(y_test, predictions, output_dict=True, zero_division=0)

    bundle = {
        "model": clf,
        "features": MODEL_FEATURES,
        "labels": labels,
        "horizon_days": horizon_days,
        "metrics": {
            "accuracy": accuracy,
            "classification_report": report,
            "rows": len(df),
            "train_rows": len(X_train),
            "test_rows": len(X_test),
        },
        "metadata": {
            "symbol": symbol.upper() if symbol else "ALL",
            "model_type": "logistic_regression_multiclass",
            "version": "ml-v0.3.0",
        },
    }

    model_path = save_model_bundle(bundle)

    return TrainResult(
        rows=len(df),
        train_rows=len(X_train),
        test_rows=len(X_test),
        accuracy=accuracy,
        labels=labels,
        model_path=model_path,
    )