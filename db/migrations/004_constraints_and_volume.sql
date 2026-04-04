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

ALTER TABLE technical_features
  ADD COLUMN IF NOT EXISTS volume_ratio_20d NUMERIC(18,6);