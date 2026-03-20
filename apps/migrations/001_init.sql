CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tickers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol TEXT NOT NULL UNIQUE,
  company_name TEXT NOT NULL,
  exchange TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS holdings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ticker_id UUID NOT NULL REFERENCES tickers(id) ON DELETE CASCADE,
  shares_owned NUMERIC(18,6) NOT NULL CHECK (shares_owned >= 0),
  average_cost_basis NUMERIC(18,6),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS historical_prices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticker_id UUID NOT NULL REFERENCES tickers(id) ON DELETE CASCADE,
  trading_date DATE NOT NULL,
  open NUMERIC(18,6) NOT NULL,
  high NUMERIC(18,6) NOT NULL,
  low NUMERIC(18,6) NOT NULL,
  close NUMERIC(18,6) NOT NULL,
  adjusted_close NUMERIC(18,6),
  volume BIGINT NOT NULL,
  source TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (ticker_id, trading_date)
);

CREATE TABLE IF NOT EXISTS predictions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticker_id UUID NOT NULL REFERENCES tickers(id) ON DELETE CASCADE,
  prediction_date DATE NOT NULL,
  horizon_days INT NOT NULL,
  predicted_direction TEXT NOT NULL,
  predicted_return_pct NUMERIC(10,4),
  confidence_score NUMERIC(6,4) NOT NULL CHECK (confidence_score >= 0 AND confidence_score <= 1),
  recommendation TEXT NOT NULL,
  explanation_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  model_version TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS technical_features (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticker_id UUID NOT NULL REFERENCES tickers(id) ON DELETE CASCADE,
  trading_date DATE NOT NULL,
  sma_20 NUMERIC(18,6),
  sma_50 NUMERIC(18,6),
  ema_12 NUMERIC(18,6),
  ema_26 NUMERIC(18,6),
  rsi_14 NUMERIC(18,6),
  macd NUMERIC(18,6),
  momentum_5d NUMERIC(18,6),
  momentum_20d NUMERIC(18,6),
  volatility_20d NUMERIC(18,6),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (ticker_id, trading_date)
);

INSERT INTO tickers (symbol, company_name, exchange)
VALUES
  ('AAPL', 'Apple Inc.', 'NASDAQ'),
  ('MSFT', 'Microsoft Corporation', 'NASDAQ'),
  ('GOOGL', 'Alphabet Inc.', 'NASDAQ'),
  ('AMZN', 'Amazon.com, Inc.', 'NASDAQ'),
  ('NVDA', 'NVIDIA Corporation', 'NASDAQ')
ON CONFLICT (symbol) DO NOTHING;