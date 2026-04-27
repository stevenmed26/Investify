ALTER TABLE tickers
  ADD COLUMN IF NOT EXISTS sector TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'holdings_user_ticker_unique'
  ) THEN
    ALTER TABLE holdings
      ADD CONSTRAINT holdings_user_ticker_unique UNIQUE (user_id, ticker_id);
  END IF;
END $$;

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