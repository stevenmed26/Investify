from __future__ import annotations

import pandas as pd
from app.db import get_connection


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
    "close",
]


def _coerce_numeric_columns(df: pd.DataFrame, columns: list[str]) -> pd.DataFrame:
    for col in columns:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")
    return df


def _build_labels(df: pd.DataFrame) -> pd.DataFrame:
    if df.empty:
        return df

    valid_returns = df["forward_return_pct"].dropna()
    if valid_returns.empty:
        return df.iloc[0:0].copy()

    lower = float(valid_returns.quantile(0.33))
    upper = float(valid_returns.quantile(0.67))

    if lower >= upper:
        lower = -0.5
        upper = 0.5

    def label_fn(x: float) -> str:
        if x >= upper:
            return "bullish"
        if x <= lower:
            return "bearish"
        return "neutral"

    df["label"] = df["forward_return_pct"].apply(label_fn)
    return df


def load_training_dataframe(symbol: str | None = None, horizon_days: int = 5) -> pd.DataFrame:
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
        df = pd.read_sql(query, conn, params=params)

    if df.empty:
        return df

    numeric_columns = [
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
        "future_close",
    ]
    df = _coerce_numeric_columns(df, numeric_columns)

    if "trading_date" in df.columns:
        df["trading_date"] = pd.to_datetime(df["trading_date"], errors="coerce")

    df = df.dropna(subset=["close", "future_close"]).copy()

    df["price_vs_sma20"] = (df["close"] / df["sma_20"]) - 1.0
    df["price_vs_sma50"] = (df["close"] / df["sma_50"]) - 1.0
    df["ema_gap"] = df["ema_12"] - df["ema_26"]
    df["forward_return_pct"] = ((df["future_close"] / df["close"]) - 1.0) * 100.0

    feature_set = FEATURE_COLUMNS + ["price_vs_sma20", "price_vs_sma50", "ema_gap"]
    df = df.dropna(subset=feature_set).reset_index(drop=True)

    if df.empty:
        return df

    df = _build_labels(df)

    if "label" not in df.columns:
        return df.iloc[0:0].copy()

    label_counts = df["label"].value_counts(dropna=False)
    if len(label_counts.index) < 2:
        return df.iloc[0:0].copy()

    return df.reset_index(drop=True)


def load_latest_feature_row(symbol: str) -> pd.DataFrame:
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
        df = pd.read_sql(query, conn, params=[symbol.upper()])

    if df.empty:
        return df

    numeric_columns = [
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
    ]
    df = _coerce_numeric_columns(df, numeric_columns)

    if "trading_date" in df.columns:
        df["trading_date"] = pd.to_datetime(df["trading_date"], errors="coerce")

    df["price_vs_sma20"] = (df["close"] / df["sma_20"]) - 1.0
    df["price_vs_sma50"] = (df["close"] / df["sma_50"]) - 1.0
    df["ema_gap"] = df["ema_12"] - df["ema_26"]

    df = df.dropna().reset_index(drop=True)
    return df