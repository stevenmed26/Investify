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

from app.services.dataset import (
    load_training_dataframe,
    build_labels_for_split,
    add_derived_features,
    ALL_MODEL_FEATURES,
)
from app.services.model_store import save_model_bundle

logger = logging.getLogger(__name__)


@dataclass
class TrainResult:
    rows: int
    train_rows: int
    test_rows: int
    accuracy: float
    labels: list[str]
    model_path: str
    tickers: list[str]


def _chronological_split(
    df: pd.DataFrame, test_fraction: float = 0.2
) -> tuple[pd.DataFrame, pd.DataFrame]:
    """
    Split per-ticker chronologically, then pool train and test chunks.

    Each ticker contributes its earliest 80% to train and latest 20% to test,
    so every ticker appears in both splits regardless of the combined sort order.
    """
    train_chunks: list[pd.DataFrame] = []
    test_chunks: list[pd.DataFrame] = []

    for symbol, group in df.groupby("symbol", sort=False):
        group = group.sort_values("trading_date").reset_index(drop=True)
        split_idx = max(1, int(len(group) * (1 - test_fraction)))
        train_chunks.append(group.iloc[:split_idx])
        test_chunks.append(group.iloc[split_idx:])
        logger.debug(
            "[trainer] split symbol=%s total=%d train=%d test=%d",
            symbol, len(group), split_idx, len(group) - split_idx,
        )

    return (
        pd.concat(train_chunks, ignore_index=True),
        pd.concat(test_chunks, ignore_index=True),
    )


def train_model(horizon_days: int = 5) -> TrainResult:
    """
    Train a shared prediction model on ALL available ticker data.

    Strict no-leakage order of operations:
      1. Load raw rows (no labels, no derived features)
      2. Chronological split per-ticker
      3. Add derived features to each split independently
      4. Label each split using thresholds from that split only
      5. Fit on train, evaluate on test
    """
    logger.info("[trainer] starting training horizon_days=%d scope=ALL", horizon_days)

    df = load_training_dataframe(symbol=None, horizon_days=horizon_days)

    if df.empty:
        raise ValueError(
            "No training data. Seed 365 days of history and backfill "
            "features for all tickers before training."
        )

    tickers = sorted(df["symbol"].unique().tolist()) if "symbol" in df.columns else []
    logger.info("[trainer] raw data loaded tickers=%s rows=%d", tickers, len(df))

    if len(df) < 20:
        raise ValueError(f"Not enough rows to train (have {len(df)}, need ≥20).")

    # Step 1: chronological split (raw, no features, no labels)
    train_df, test_df = _chronological_split(df, test_fraction=0.2)
    logger.info("[trainer] raw split train_rows=%d test_rows=%d", len(train_df), len(test_df))

    # Step 2: derived features computed independently per split
    train_df = add_derived_features(train_df)
    test_df  = add_derived_features(test_df)

    # Step 3: labels computed independently per split — no cross-contamination
    train_df = build_labels_for_split(train_df)
    test_df  = build_labels_for_split(test_df)

    if "label" not in train_df.columns or train_df.empty:
        raise ValueError("Labeling produced no rows for the training split.")
    if "label" not in test_df.columns or test_df.empty:
        raise ValueError("Labeling produced no rows for the test split.")

    train_df = train_df.dropna(subset=ALL_MODEL_FEATURES).reset_index(drop=True)
    test_df  = test_df.dropna(subset=ALL_MODEL_FEATURES).reset_index(drop=True)

    X_train = train_df[ALL_MODEL_FEATURES].copy()
    y_train = train_df["label"].copy()
    X_test  = test_df[ALL_MODEL_FEATURES].copy()
    y_test  = test_df["label"].copy()

    train_labels = sorted(list(np.unique(y_train)))
    test_labels  = sorted(list(np.unique(y_test)))

    logger.info(
        "[trainer] labeled split train_rows=%d test_rows=%d "
        "train_labels=%s test_labels=%s",
        len(X_train), len(X_test), train_labels, test_labels,
    )
    logger.info("[trainer] train label distribution: %s", y_train.value_counts().to_dict())
    logger.info("[trainer] test  label distribution: %s", y_test.value_counts().to_dict())
    logger.info("[trainer] model features (%d): %s", len(ALL_MODEL_FEATURES), ALL_MODEL_FEATURES)

    if len(train_labels) < 2:
        raise ValueError(f"Training split has only one class: {train_labels}.")

    numeric_transformer = Pipeline(steps=[
        ("imputer", SimpleImputer(strategy="median")),
        ("scaler",  StandardScaler()),
    ])

    clf = Pipeline(steps=[
        ("preprocessor", ColumnTransformer(transformers=[
            ("num", numeric_transformer, ALL_MODEL_FEATURES),
        ])),
        ("classifier", LogisticRegression(
            max_iter=1000,
            class_weight="balanced",
            random_state=42,
        )),
    ])

    logger.info("[trainer] fitting model features=%d train_rows=%d", len(ALL_MODEL_FEATURES), len(X_train))
    clf.fit(X_train, y_train)

    predictions = clf.predict(X_test)
    accuracy    = float(accuracy_score(y_test, predictions))
    labels      = sorted(list(np.unique(pd.concat([y_train, y_test]))))
    report      = classification_report(y_test, predictions, output_dict=True, zero_division=0)

    logger.info(
        "[trainer] training complete accuracy=%.4f labels=%s tickers=%s "
        "train_rows=%d test_rows=%d",
        accuracy, labels, tickers, len(X_train), len(X_test),
    )
    logger.debug("[trainer] classification report: %s", report)

    bundle = {
        "model":        clf,
        "features":     ALL_MODEL_FEATURES,
        "labels":       labels,
        "horizon_days": horizon_days,
        "metrics": {
            "accuracy":              accuracy,
            "classification_report": report,
            "rows":                  len(df),
            "train_rows":            len(X_train),
            "test_rows":             len(X_test),
        },
        "metadata": {
            "tickers":    tickers,
            "scope":      "ALL",
            "model_type": "logistic_regression_multiclass",
            "version":    "ml-v0.6.0",
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