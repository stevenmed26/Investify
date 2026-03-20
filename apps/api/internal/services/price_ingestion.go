package services

import (
	"context"
	"fmt"
	"strings"
	"time"

	"investify/apps/api/internal/marketdata"

	"github.com/jackc/pgx/v5/pgxpool"
)

type PriceIngestionService struct {
	DB       *pgxpool.Pool
	Provider marketdata.Provider
}

func (s *PriceIngestionService) IngestBySymbol(ctx context.Context, symbol string, days int) (int, error) {
	symbol = strings.ToUpper(strings.TrimSpace(symbol))
	if symbol == "" {
		return 0, fmt.Errorf("symbol is required")
	}

	var tickerID string
	err := s.DB.QueryRow(ctx, `
		SELECT id
		FROM tickers
		WHERE symbol = $1
	`, symbol).Scan(&tickerID)
	if err != nil {
		return 0, fmt.Errorf("ticker not found: %w", err)
	}

	prices, err := s.Provider.FetchDailyHistory(ctx, symbol, days)
	if err != nil {
		return 0, fmt.Errorf("fetch history: %w", err)
	}

	tx, err := s.DB.Begin(ctx)
	if err != nil {
		return 0, fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx)

	inserted := 0
	for _, p := range prices {
		_, err := tx.Exec(ctx, `
			INSERT INTO historical_prices (
				ticker_id,
				trading_date,
				open,
				high,
				low,
				close,
				adjusted_close,
				volume,
				source,
				created_at
			)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
			ON CONFLICT (ticker_id, trading_date)
			DO UPDATE SET
				open = EXCLUDED.open,
				high = EXCLUDED.high,
				low = EXCLUDED.low,
				close = EXCLUDED.close,
				adjusted_close = EXCLUDED.adjusted_close,
				volume = EXCLUDED.volume,
				source = EXCLUDED.source
		`, tickerID, p.TradingDate, p.Open, p.High, p.Low, p.Close, p.AdjustedClose, p.Volume, p.Source, time.Now().UTC())
		if err != nil {
			return 0, fmt.Errorf("insert price row: %w", err)
		}
		inserted++
	}

	if err := tx.Commit(ctx); err != nil {
		return 0, fmt.Errorf("commit tx: %w", err)
	}

	return inserted, nil
}
