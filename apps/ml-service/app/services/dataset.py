from __future__ import annotations

import logging

import pandas as pd
from app.db import get_connection

logger = logging.getLogger(__name__)

FEATURE_COLUMNS = [
    "sma_20",
    "sma_50",
    "ema_12",
    "ema_26",
    "rsi_14",
    "macd",
    "momentum_5d",
    "momentum_20d",
    "volatility_20d",
    # Relative price position — replaces raw `close` which leaks absolute price
    # scale into the model and has no predictive meaning across tickers.
    "price_vs_sma20",
    "price_vs_sma50",
    "ema_gap",
]


def _coerce_numeric_columns(df: pd.DataFrame, columns: list[str]) -> pd.DataFrame:
    for col in columns:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")
    return df


def _build_labels_per_ticker(df: pd.DataFrame) -> pd.DataFrame:
    """
    Compute forward-return quantile thresholds independently per ticker, then
    assign bullish/neutral/bearish labels before concatenating.

    Previously labels were computed across all tickers combined, which caused
    data leakage: a volatile stock's large swings would shift the thresholds so
    that a perfectly normal move in a low-volatility stock got mislabeled.
    """
    if df.empty:
        return df

    labeled_chunks: list[pd.DataFrame] = []

    for symbol, group in df.groupby("symbol", sort=False):
        group = group.copy()
        valid = group["forward_return_pct"].dropna()

        if valid.empty:
            logger.warning("[dataset] skipping symbol=%s — no valid forward returns", symbol)
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
            symbol,
            len(group),
            counts.get("bullish", 0),
            counts.get("neutral", 0),
            counts.get("bearish", 0),
            lower,
            upper,
        )

        labeled_chunks.append(group)

    if not labeled_chunks:
        logger.warning("[dataset] no labeled chunks produced — returning empty dataframe")
        return df.iloc[0:0].copy()

    return pd.concat(labeled_chunks, ignore_index=True)


def _cursor_to_df(cur) -> pd.DataFrame:
    """
    Build a DataFrame from a psycopg3 cursor result without pd.read_sql.
    pd.read_sql requires a SQLAlchemy connection; psycopg3 is not supported.
    """
    rows = cur.fetchall()
    if not rows:
        return pd.DataFrame()
    if isinstance(rows[0], dict):
        return pd.DataFrame(rows)
    cols = [desc[0] for desc in cur.description]
    return pd.DataFrame(rows, columns=cols)


def load_training_dataframe(symbol: str | None = None, horizon_days: int = 5) -> pd.DataFrame:
    """
    Load all labeled training rows from the database.

    When symbol is None (the default and recommended path), data from ALL tickers
    is loaded. This is the correct way to train — a model that sees AAPL, MSFT,
    GOOGL, AMZN, and NVDA together learns generalizable technical patterns rather
    than overfitting to a single stock's price history.

    The symbol filter is kept for debugging / experimentation only.
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
                tf.sma_20,
                tf.sma_50,
                tf.ema_12,
                tf.ema_26,
                tf.rsi_14,
                tf.macd,
                tf.momentum_5d,
                tf.momentum_20d,
                tf.volatility_20d,
                hp.close,
                LEAD(hp.close, %s) OVER (
                    PARTITION BY tf.ticker_id
                    ORDER BY tf.trading_date
                ) AS future_close
            FROM technical_features tf
            JOIN tickers t
              ON t.id = tf.ticker_id
            JOIN historical_prices hp
              ON hp.ticker_id = tf.ticker_id
             AND hp.trading_date = tf.trading_date
            {where_clause}
        )
        SELECT
            symbol,
            trading_date,
            sma_20,
            sma_50,
            ema_12,
            ema_26,
            rsi_14,
            macd,
            momentum_5d,
            momentum_20d,
            volatility_20d,
            close,
            future_close
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

    numeric_columns = [
        "sma_20", "sma_50", "ema_12", "ema_26", "rsi_14", "macd",
        "momentum_5d", "momentum_20d", "volatility_20d", "close", "future_close",
    ]
    df = _coerce_numeric_columns(df, numeric_columns)

    if "trading_date" in df.columns:
        df["trading_date"] = pd.to_datetime(df["trading_date"], errors="coerce")

    before_drop = len(df)
    df = df.dropna(subset=["close", "future_close"]).copy()
    logger.debug(
        "[dataset] dropped rows missing close/future_close before=%d after=%d",
        before_drop, len(df),
    )

    df["price_vs_sma20"] = (df["close"] / df["sma_20"]) - 1.0
    df["price_vs_sma50"] = (df["close"] / df["sma_50"]) - 1.0
    df["ema_gap"] = df["ema_12"] - df["ema_26"]
    df["forward_return_pct"] = ((df["future_close"] / df["close"]) - 1.0) * 100.0

    before_drop = len(df)
    df = df.dropna(subset=FEATURE_COLUMNS).reset_index(drop=True)
    logger.debug(
        "[dataset] dropped rows with null features before=%d after=%d",
        before_drop, len(df),
    )

    if df.empty:
        logger.warning("[dataset] no rows remain after feature null-drop scope=%s", scope)
        return df

    df = _build_labels_per_ticker(df)

    if "label" not in df.columns or df.empty:
        logger.warning("[dataset] labeling produced no rows scope=%s", scope)
        return df.iloc[0:0].copy()

    label_counts = df["label"].value_counts(dropna=False).to_dict()
    if len(label_counts) < 2:
        logger.warning(
            "[dataset] only one label class present=%s scope=%s — not enough variance to train",
            label_counts, scope,
        )
        return df.iloc[0:0].copy()

    tickers_in_df = df["symbol"].nunique() if "symbol" in df.columns else "?"
    logger.info(
        "[dataset] final training dataframe scope=%s tickers=%s rows=%d "
        "bullish=%d neutral=%d bearish=%d",
        scope,
        tickers_in_df,
        len(df),
        label_counts.get("bullish", 0),
        label_counts.get("neutral", 0),
        label_counts.get("bearish", 0),
    )

    return df.reset_index(drop=True)


def load_latest_feature_row(symbol: str) -> pd.DataFrame:
    """Load the single most recent feature row for a symbol, used at prediction time."""
    logger.debug("[dataset] load_latest_feature_row symbol=%s", symbol)

    query = """
        SELECT
            t.symbol,
            tf.trading_date,
            tf.sma_20,
            tf.sma_50,
            tf.ema_12,
            tf.ema_26,
            tf.rsi_14,
            tf.macd,
            tf.momentum_5d,
            tf.momentum_20d,
            tf.volatility_20d,
            hp.close
        FROM technical_features tf
        JOIN tickers t
          ON t.id = tf.ticker_id
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

    numeric_columns = [
        "sma_20", "sma_50", "ema_12", "ema_26", "rsi_14", "macd",
        "momentum_5d", "momentum_20d", "volatility_20d", "close",
    ]
    df = _coerce_numeric_columns(df, numeric_columns)

    if "trading_date" in df.columns:
        df["trading_date"] = pd.to_datetime(df["trading_date"], errors="coerce")

    df["price_vs_sma20"] = (df["close"] / df["sma_20"]) - 1.0
    df["price_vs_sma50"] = (df["close"] / df["sma_50"]) - 1.0
    df["ema_gap"] = df["ema_12"] - df["ema_26"]

    before = len(df)
    df = df.dropna().reset_index(drop=True)

    if df.empty:
        logger.warning(
            "[dataset] feature row for symbol=%s dropped after null-check "
            "(missing indicator values — backfill features first)",
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