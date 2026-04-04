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
  sector TEXT,
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
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT holdings_user_ticker_unique UNIQUE (user_id, ticker_id)
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
  volume_ratio_20d NUMERIC(18,6),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (ticker_id, trading_date)
);

CREATE TABLE IF NOT EXISTS user_api_credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  encrypted_api_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, provider)
);

CREATE TABLE IF NOT EXISTS pipeline_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  tickers_ok INT NOT NULL DEFAULT 0,
  tickers_fail INT NOT NULL DEFAULT 0,
  train_ok BOOLEAN NOT NULL DEFAULT FALSE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO tickers (symbol, company_name, exchange, sector)
VALUES
  ('AAPL', 'Apple Inc.', 'NASDAQ', 'Technology'),
  ('MSFT', 'Microsoft Corporation', 'NASDAQ', 'Technology'),
  ('GOOGL', 'Alphabet Inc.', 'NASDAQ', 'Communication Services'),
  ('AMZN', 'Amazon.com, Inc.', 'NASDAQ', 'Consumer Discretionary'),
  ('NVDA', 'NVIDIA Corporation', 'NASDAQ', 'Technology')
ON CONFLICT (symbol) DO NOTHING;

INSERT INTO users (id, email, password_hash)
VALUES (
  '11111111-1111-1111-1111-111111111111',
  'demo@investify.local',
  'dev-only-placeholder'
)
ON CONFLICT (email) DO NOTHING;