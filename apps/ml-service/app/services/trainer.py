from __future__ import annotations

import logging
from dataclasses import dataclass

import numpy as np
import pandas as pd
from sklearn.calibration import CalibratedClassifierCV
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
    Split per-ticker chronologically then pool chunks.
    Each ticker contributes its earliest 80% to train and latest 20% to test.
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

    No-leakage order of operations:
      1. Load raw rows (no labels, no derived features)
      2. Chronological split per-ticker into train (80%) / calibration (20%)
      3. Add derived features to each split independently
      4. Label each split using thresholds from that split only
      5. Fit base classifier on train
      6. Calibrate probabilities using calibration split (Platt scaling)
      7. Evaluate calibrated model on calibration split

    Step 6 is what fixes confidence=1.0000.

    Why calibration is necessary:
    Logistic regression fitted on training data from a bullish 2025 market produces
    raw decision function scores with magnitudes that saturate the sigmoid when
    applied to out-of-distribution bearish data (e.g. March 2026 sell-off). Any
    feature vector more than ~4 std devs from the training mean produces
    probability = 0.9999+ even if the true probability is more like 0.60.

    CalibratedClassifierCV with method='sigmoid' (Platt scaling) fits a logistic
    regression layer on top of the raw decision function scores, using the
    calibration set as held-out data. This maps extreme scores back to reasonable
    probabilities while preserving the rank order of predictions.
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

    train_df, cal_df = _chronological_split(df, test_fraction=0.2)
    logger.info("[trainer] raw split train_rows=%d cal_rows=%d", len(train_df), len(cal_df))

    train_df = add_derived_features(train_df)
    cal_df   = add_derived_features(cal_df)

    train_df = build_labels_for_split(train_df)
    cal_df   = build_labels_for_split(cal_df)

    if "label" not in train_df.columns or train_df.empty:
        raise ValueError("Labeling produced no rows for the training split.")
    if "label" not in cal_df.columns or cal_df.empty:
        raise ValueError("Labeling produced no rows for the calibration split.")

    train_df = train_df.dropna(subset=ALL_MODEL_FEATURES).reset_index(drop=True)
    cal_df   = cal_df.dropna(subset=ALL_MODEL_FEATURES).reset_index(drop=True)

    X_train = train_df[ALL_MODEL_FEATURES].copy()
    y_train = train_df["label"].copy()
    X_cal   = cal_df[ALL_MODEL_FEATURES].copy()
    y_cal   = cal_df["label"].copy()

    train_labels = sorted(list(np.unique(y_train)))
    cal_labels   = sorted(list(np.unique(y_cal)))

    logger.info(
        "[trainer] labeled split train_rows=%d cal_rows=%d "
        "train_labels=%s cal_labels=%s",
        len(X_train), len(X_cal), train_labels, cal_labels,
    )
    logger.info("[trainer] train label distribution: %s", y_train.value_counts().to_dict())
    logger.info("[trainer] cal   label distribution: %s", y_cal.value_counts().to_dict())
    logger.info("[trainer] model features (%d): %s", len(ALL_MODEL_FEATURES), ALL_MODEL_FEATURES)

    if len(train_labels) < 2:
        raise ValueError(f"Training split has only one class: {train_labels}.")

    # Step 4: fit base classifier
    numeric_transformer = Pipeline(steps=[
        ("imputer", SimpleImputer(strategy="median")),
        ("scaler",  StandardScaler()),
    ])

    base_clf = Pipeline(steps=[
        ("preprocessor", ColumnTransformer(transformers=[
            ("num", numeric_transformer, ALL_MODEL_FEATURES),
        ])),
        ("classifier", LogisticRegression(
            max_iter=1000,
            class_weight="balanced",
            random_state=42,
        )),
    ])

    logger.info("[trainer] fitting base model features=%d train_rows=%d", len(ALL_MODEL_FEATURES), len(X_train))
    base_clf.fit(X_train, y_train)

    logger.info("[trainer] calibrating probabilities method=sigmoid cal_rows=%d", len(X_cal))
    calibrated_clf = CalibratedClassifierCV(
        estimator=base_clf,
        method="sigmoid",
        cv="prefit",
    )
    calibrated_clf.fit(X_cal, y_cal)

    # Step 6: evaluate calibrated model
    predictions = calibrated_clf.predict(X_cal)
    probabilities = calibrated_clf.predict_proba(X_cal)
    accuracy = float(accuracy_score(y_cal, predictions))
    labels   = sorted(list(np.unique(pd.concat([y_train, y_cal]))))
    report   = classification_report(y_cal, predictions, output_dict=True, zero_division=0)

    # Log a sample of probabilities to verify calibration worked
    max_probs = probabilities.max(axis=1)
    logger.info(
        "[trainer] calibration check — max_prob: min=%.4f mean=%.4f max=%.4f "
        "(should no longer be near 1.0 for all samples)",
        max_probs.min(), max_probs.mean(), max_probs.max(),
    )
    logger.info(
        "[trainer] training complete accuracy=%.4f labels=%s tickers=%s "
        "train_rows=%d cal_rows=%d",
        accuracy, labels, tickers, len(X_train), len(X_cal),
    )
    logger.debug("[trainer] classification report: %s", report)

    bundle = {
        "model":        calibrated_clf,
        "features":     ALL_MODEL_FEATURES,
        "labels":       labels,
        "horizon_days": horizon_days,
        "metrics": {
            "accuracy":              accuracy,
            "classification_report": report,
            "rows":                  len(df),
            "train_rows":            len(X_train),
            "test_rows":             len(X_cal),
        },
        "metadata": {
            "tickers":    tickers,
            "scope":      "ALL",
            "model_type": "logistic_regression_calibrated",
            "version":    "ml-v0.7.0",
        },
    }

    model_path = save_model_bundle(bundle)
    logger.info("[trainer] model saved path=%s", model_path)

    return TrainResult(
        rows=len(df),
        train_rows=len(X_train),
        test_rows=len(X_cal),
        accuracy=accuracy,
        labels=labels,
        model_path=model_path,
        tickers=tickers,
    )