from __future__ import annotations

import logging
from dataclasses import dataclass

import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, classification_report
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

from app.services.dataset import load_training_dataframe, FEATURE_COLUMNS
from app.services.model_store import save_model_bundle

logger = logging.getLogger(__name__)

MODEL_FEATURES = [f for f in FEATURE_COLUMNS if f != "close"]


@dataclass
class TrainResult:
    rows: int
    train_rows: int
    test_rows: int
    accuracy: float
    labels: list[str]
    model_path: str
    tickers: list[str]


def _chronological_split(df: pd.DataFrame, test_fraction: float = 0.2) -> tuple[pd.DataFrame, pd.DataFrame]:
    """
    Split per ticker chronologically, then recombine.

    The naive approach — sorting the entire combined dataframe by date and
    splitting at 80% — puts the most recent weeks of one ticker (whichever
    sorts last alphabetically) almost entirely in the test set, while other
    tickers have no test representation at all. This produces misleading
    accuracy numbers and trains on stale data from some stocks.

    Instead, we take the last 20% of each ticker's own time series as its
    test contribution, then pool the train and test chunks separately.
    This ensures every ticker is represented in both splits.
    """
    train_chunks: list[pd.DataFrame] = []
    test_chunks:  list[pd.DataFrame] = []

    for symbol, group in df.groupby("symbol", sort=False):
        group = group.sort_values("trading_date").reset_index(drop=True)
        split_idx = max(1, int(len(group) * (1 - test_fraction)))
        train_chunks.append(group.iloc[:split_idx])
        test_chunks.append(group.iloc[split_idx:])
        logger.debug(
            "[trainer] split symbol=%s total=%d train=%d test=%d",
            symbol, len(group), split_idx, len(group) - split_idx,
        )

    train_df = pd.concat(train_chunks, ignore_index=True)
    test_df  = pd.concat(test_chunks,  ignore_index=True)
    return train_df, test_df


def train_model(horizon_days: int = 5) -> TrainResult:
    """
    Train a single shared model on ALL available ticker data.

    Correct flow:
      1. Batch ingest history for all tickers  (365 days recommended)
      2. Batch backfill features for all tickers
      3. Call this endpoint once — trains on everything
      4. Predict per symbol using the shared model
    """
    logger.info("[trainer] starting training horizon_days=%d scope=ALL", horizon_days)

    df = load_training_dataframe(symbol=None, horizon_days=horizon_days)

    if df.empty:
        raise ValueError(
            "No training data available. Seed history (365 days) and backfill "
            "features for all tickers before training."
        )

    tickers = sorted(df["symbol"].unique().tolist()) if "symbol" in df.columns else []
    logger.info("[trainer] loaded data tickers=%s total_rows=%d", tickers, len(df))

    missing_features = [col for col in MODEL_FEATURES if col not in df.columns]
    if missing_features:
        raise ValueError(f"Missing required feature columns: {missing_features}")

    if "label" not in df.columns:
        raise ValueError("Missing label column — labeling failed during data load")

    if len(df) < 20:
        raise ValueError(
            f"Not enough rows to train (have {len(df)}, need at least 20). "
            "Seed more history and backfill features."
        )

    all_labels = sorted(list(np.unique(df["label"])))
    logger.info("[trainer] label distribution: %s", df["label"].value_counts().to_dict())

    if len(all_labels) < 2:
        raise ValueError(
            f"Need at least 2 label classes, found {len(all_labels)}: {all_labels}"
        )

    # Per-ticker chronological split — see docstring above for why
    train_df, test_df = _chronological_split(df, test_fraction=0.2)

    X_train = train_df[MODEL_FEATURES].copy()
    y_train = train_df["label"].copy()
    X_test  = test_df[MODEL_FEATURES].copy()
    y_test  = test_df["label"].copy()

    train_labels = sorted(list(np.unique(y_train)))
    test_labels  = sorted(list(np.unique(y_test)))

    logger.info(
        "[trainer] split train_rows=%d test_rows=%d "
        "train_labels=%s test_labels=%s",
        len(X_train), len(X_test), train_labels, test_labels,
    )

    if len(train_labels) < 2:
        raise ValueError(
            f"Training split has only one class: {train_labels}. "
            "Seed more history."
        )

    numeric_transformer = Pipeline(steps=[
        ("imputer", SimpleImputer(strategy="median")),
        ("scaler",  StandardScaler()),
    ])

    preprocessor = ColumnTransformer(transformers=[
        ("num", numeric_transformer, MODEL_FEATURES),
    ])

    clf = Pipeline(steps=[
        ("preprocessor", preprocessor),
        ("classifier", LogisticRegression(
            max_iter=1000,
            # multi_class="multinomial" removed — deprecated in sklearn 1.5,
            # multinomial is now the default for multi-class problems
            class_weight="balanced",
            random_state=42,
        )),
    ])

    logger.info("[trainer] fitting model features=%d train_rows=%d", len(MODEL_FEATURES), len(X_train))
    clf.fit(X_train, y_train)

    predictions = clf.predict(X_test)
    accuracy    = float(accuracy_score(y_test, predictions))
    labels      = sorted(list(np.unique(df["label"])))
    report      = classification_report(y_test, predictions, output_dict=True, zero_division=0)

    logger.info(
        "[trainer] training complete accuracy=%.4f labels=%s tickers=%s "
        "train_rows=%d test_rows=%d",
        accuracy, labels, tickers, len(X_train), len(X_test),
    )
    logger.debug("[trainer] classification report: %s", report)

    bundle = {
        "model":    clf,
        "features": MODEL_FEATURES,
        "labels":   labels,
        "horizon_days": horizon_days,
        "metrics": {
            "accuracy": accuracy,
            "classification_report": report,
            "rows":       len(df),
            "train_rows": len(X_train),
            "test_rows":  len(X_test),
        },
        "metadata": {
            "tickers":    tickers,
            "scope":      "ALL",
            "model_type": "logistic_regression_multiclass",
            "version":    "ml-v0.4.0",
        },
    }

    model_path = save_model_bundle(bundle)
    logger.info("[trainer] model saved path=%s", model_path)

    return TrainResult(
        rows=len(df),
        train_rows=len(X_train),
        test_rows=len(X_test),
        accuracy=accuracy,
        labels=labels,
        model_path=model_path,
        tickers=tickers,
    )