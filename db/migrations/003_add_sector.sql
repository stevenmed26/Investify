-- Add sector column to tickers (populated from registry JSON on startup)
ALTER TABLE tickers ADD COLUMN IF NOT EXISTS sector TEXT;

-- Holdings unique constraint so upsert works correctly
-- (user can only have one holding per ticker — update shares instead of duplicating)
ALTER TABLE holdings ADD CONSTRAINT IF NOT EXISTS holdings_user_ticker_unique
  UNIQUE (user_id, ticker_id);

-- Pipeline runs audit table
CREATE TABLE IF NOT EXISTS pipeline_runs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at   TIMESTAMPTZ,
  tickers_ok    INT NOT NULL DEFAULT 0,
  tickers_fail  INT NOT NULL DEFAULT 0,
  train_ok      BOOLEAN NOT NULL DEFAULT FALSE,
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);