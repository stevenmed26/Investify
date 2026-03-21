from __future__ import annotations

import logging

import pandas as pd
from app.db import get_connection

logger = logging.getLogger(__name__)

# Raw DB columns fetched for training — includes price-level indicators
# needed to compute derived ratios, but NOT used directly as model features.
RAW_INDICATOR_COLUMNS = [
    "sma_20",
    "sma_50",
    "ema_12",
    "ema_26",
    "rsi_14",
    "macd",
    "momentum_5d",
    "momentum_20d",
    "volatility_20d",
]

# The actual model feature set — every column here must be dimensionless
# (scale-invariant across tickers) so that a StandardScaler fitted on
# mixed AAPL/NVDA training data produces meaningful z-scores at inference.
#
# Removed from previous version:
#   sma_20, sma_50, ema_12, ema_26 — raw dollar prices (5-100x range across tickers)
#   macd (raw)    — ema_12 - ema_26 in dollars, same scale problem
#   ema_gap       — duplicate of macd, also dollar-denominated
#
# What remains or was added:
#   price_vs_sma20/50  — (close/sma) - 1, dimensionless ratio
#   macd_pct           — macd / close, normalises MACD to % of price
#   rsi_14             — already 0-100 bounded, fine
#   momentum_5d/20d    — ((price/prev)-1)*100, already a % return
#   volatility_20d     — annualised % vol, already dimensionless
ALL_MODEL_FEATURES = [
    "rsi_14",
    "momentum_5d",
    "momentum_20d",
    "volatility_20d",
    "price_vs_sma20",
    "price_vs_sma50",
    "macd_pct",
]


def _coerce_numeric_columns(df: pd.DataFrame, columns: list[str]) -> pd.DataFrame:
    for col in columns:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")
    return df


def build_labels_for_split(df: pd.DataFrame) -> pd.DataFrame:
    """
    Assign bullish/neutral/bearish labels using quantile thresholds computed
    ONLY on the rows in `df`.

    Must be called separately on each split after _chronological_split() —
    never on the full dataset, which would leak test return distribution
    into training labels.
    """
    if df.empty:
        return df

    labeled_chunks: list[pd.DataFrame] = []

    for symbol, group in df.groupby("symbol", sort=False):
        group = group.copy()
        valid = group["forward_return_pct"].dropna()

        if valid.empty:
            logger.warning("[dataset] skipping label build symbol=%s — no valid forward returns", symbol)
            continue

        lower = float(valid.quantile(0.33))
        upper = float(valid.quantile(0.67))

        if lower >= upper:
            logger.warning(
                "[dataset] symbol=%s quantile range collapsed (lower=%.4f upper=%.4f), "
                "using fixed ±0.5 thresholds",
                symbol, lower, upper,
            )
            lower, upper = -0.5, 0.5

        def label_fn(x: float, lo: float = lower, hi: float = upper) -> str:
            if x >= hi:
                return "bullish"
            if x <= lo:
                return "bearish"
            return "neutral"

        group["label"] = group["forward_return_pct"].apply(label_fn)

        counts = group["label"].value_counts().to_dict()
        logger.debug(
            "[dataset] labeled symbol=%s rows=%d bullish=%d neutral=%d bearish=%d "
            "lower=%.4f upper=%.4f",
            symbol, len(group),
            counts.get("bullish", 0), counts.get("neutral", 0), counts.get("bearish", 0),
            lower, upper,
        )

        labeled_chunks.append(group)

    if not labeled_chunks:
        logger.warning("[dataset] no labeled chunks produced — returning empty dataframe")
        return df.iloc[0:0].copy()

    return pd.concat(labeled_chunks, ignore_index=True)


def _cursor_to_df(cur) -> pd.DataFrame:
    """Build a DataFrame from a psycopg3 cursor without pd.read_sql."""
    rows = cur.fetchall()
    if not rows:
        return pd.DataFrame()
    if isinstance(rows[0], dict):
        return pd.DataFrame(rows)
    cols = [desc[0] for desc in cur.description]
    return pd.DataFrame(rows, columns=cols)


def load_training_dataframe(symbol: str | None = None, horizon_days: int = 5) -> pd.DataFrame:
    """
    Load raw feature rows with forward returns. Labels are NOT assigned here.

    Labeling is deferred to trainer.py so quantile thresholds are computed
    on the train split only — never on the full dataset.

    Returns a DataFrame with raw indicators + close + future_close +
    forward_return_pct. No `label` column. The trainer adds labels after
    splitting and computing derived features.
    """
    scope = symbol.upper() if symbol else "ALL"
    logger.info("[dataset] load_training_dataframe scope=%s horizon_days=%d", scope, horizon_days)

    where_clause = ""
    params: list[object] = [horizon_days]

    if symbol:
        where_clause = "WHERE t.symbol = %s"
        params.append(symbol.upper())

    query = f"""
        WITH feature_prices AS (
            SELECT
                t.symbol,
                tf.ticker_id,
                tf.trading_date,
                tf.sma_20, tf.sma_50,
                tf.ema_12, tf.ema_26,
                tf.rsi_14, tf.macd,
                tf.momentum_5d, tf.momentum_20d,
                tf.volatility_20d,
                hp.close,
                LEAD(hp.close, %s) OVER (
                    PARTITION BY tf.ticker_id
                    ORDER BY tf.trading_date
                ) AS future_close
            FROM technical_features tf
            JOIN tickers t ON t.id = tf.ticker_id
            JOIN historical_prices hp
              ON hp.ticker_id = tf.ticker_id
             AND hp.trading_date = tf.trading_date
            {where_clause}
        )
        SELECT
            symbol, trading_date,
            sma_20, sma_50, ema_12, ema_26,
            rsi_14, macd,
            momentum_5d, momentum_20d, volatility_20d,
            close, future_close
        FROM feature_prices
        ORDER BY symbol, trading_date
    """

    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(query, params)
            df = _cursor_to_df(cur)

    logger.info("[dataset] raw rows fetched=%d scope=%s", len(df), scope)

    if df.empty:
        logger.warning("[dataset] no rows returned from DB scope=%s", scope)
        return df

    numeric_cols = RAW_INDICATOR_COLUMNS + ["close", "future_close"]
    df = _coerce_numeric_columns(df, numeric_cols)

    if "trading_date" in df.columns:
        df["trading_date"] = pd.to_datetime(df["trading_date"], errors="coerce")

    before = len(df)
    df = df.dropna(subset=["close", "future_close"]).copy()
    logger.debug("[dataset] dropped rows missing close/future_close before=%d after=%d", before, len(df))

    df["forward_return_pct"] = ((df["future_close"] / df["close"]) - 1.0) * 100.0

    # Drop rows where essential raw indicators are null — these can't produce
    # valid derived features. Use only the indicators that feed into model features.
    required_raw = ["rsi_14", "momentum_5d", "momentum_20d", "volatility_20d",
                    "sma_20", "sma_50", "macd", "close"]
    before = len(df)
    df = df.dropna(subset=required_raw).reset_index(drop=True)
    logger.debug("[dataset] dropped rows with null indicators before=%d after=%d", before, len(df))

    if df.empty:
        logger.warning("[dataset] no rows remain after null-drop scope=%s", scope)
        return df

    tickers_in_df = df["symbol"].nunique() if "symbol" in df.columns else "?"
    logger.info(
        "[dataset] training dataframe ready scope=%s tickers=%s rows=%d "
        "(labels + derived features assigned after split in trainer)",
        scope, tickers_in_df, len(df),
    )

    return df.reset_index(drop=True)


def add_derived_features(df: pd.DataFrame) -> pd.DataFrame:
    """
    Compute all dimensionless derived features from raw indicator values.

    All outputs are scale-invariant — they have the same meaning whether
    the stock price is $10 or $1000, so a StandardScaler fitted on mixed
    tickers produces valid z-scores at inference time.

    price_vs_sma20/50 : how far price is above/below its moving average, as a fraction
    macd_pct          : MACD normalised by current price — removes dollar-scale effect
    """
    df = df.copy()
    df["price_vs_sma20"] = (df["close"] / df["sma_20"]) - 1.0
    df["price_vs_sma50"] = (df["close"] / df["sma_50"]) - 1.0
    # Normalise MACD by close price to make it dimensionless across all tickers
    df["macd_pct"] = df["macd"] / df["close"]
    return df


def load_latest_feature_row(symbol: str) -> pd.DataFrame:
    """Load the single most recent feature row for a symbol, used at prediction time."""
    logger.debug("[dataset] load_latest_feature_row symbol=%s", symbol)

    query = """
        SELECT
            t.symbol,
            tf.trading_date,
            tf.sma_20, tf.sma_50,
            tf.ema_12, tf.ema_26,
            tf.rsi_14, tf.macd,
            tf.momentum_5d, tf.momentum_20d,
            tf.volatility_20d,
            hp.close
        FROM technical_features tf
        JOIN tickers t ON t.id = tf.ticker_id
        JOIN historical_prices hp
          ON hp.ticker_id = tf.ticker_id
         AND hp.trading_date = tf.trading_date
        WHERE t.symbol = %s
        ORDER BY tf.trading_date DESC
        LIMIT 1
    """

    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(query, [symbol.upper()])
            df = _cursor_to_df(cur)

    if df.empty:
        logger.warning("[dataset] no feature row found symbol=%s", symbol)
        return df

    numeric_cols = RAW_INDICATOR_COLUMNS + ["close"]
    df = _coerce_numeric_columns(df, numeric_cols)

    if "trading_date" in df.columns:
        df["trading_date"] = pd.to_datetime(df["trading_date"], errors="coerce")

    df = add_derived_features(df)

    before = len(df)
    df = df.dropna(subset=ALL_MODEL_FEATURES).reset_index(drop=True)

    if df.empty:
        logger.warning(
            "[dataset] feature row for symbol=%s dropped after null-check "
            "(some indicators missing — backfill features first)",
            symbol,
        )
        return df

    logger.debug(
        "[dataset] feature row loaded symbol=%s trading_date=%s rows_before_dropna=%d",
        symbol,
        df["trading_date"].iloc[0] if not df.empty else "?",
        before,
    )
    return df