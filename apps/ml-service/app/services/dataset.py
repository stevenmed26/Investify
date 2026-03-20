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


def load_training_dataframe(symbol: str | None = None, horizon_days: int = 5) -> pd.DataFrame:
    where_clause = ""
    params: list = [horizon_days]

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

    df = df.dropna(subset=["future_close"])

    # Derived relative features
    df["price_vs_sma20"] = (df["close"] / df["sma_20"]) - 1.0
    df["price_vs_sma50"] = (df["close"] / df["sma_50"]) - 1.0
    df["ema_gap"] = df["ema_12"] - df["ema_26"]

    # 5-day forward return in percent
    df["forward_return_pct"] = ((df["future_close"] / df["close"]) - 1.0) * 100.0

    # Labels
    def label_fn(x: float) -> str:
        if x > 2.0:
            return "bullish"
        if x < -2.0:
            return "bearish"
        return "neutral"

    df["label"] = df["forward_return_pct"].apply(label_fn)

    feature_set = FEATURE_COLUMNS + ["price_vs_sma20", "price_vs_sma50", "ema_gap"]
    df = df.dropna(subset=feature_set)

    return df


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

    df["price_vs_sma20"] = (df["close"] / df["sma_20"]) - 1.0
    df["price_vs_sma50"] = (df["close"] / df["sma_50"]) - 1.0
    df["ema_gap"] = df["ema_12"] - df["ema_26"]

    return df