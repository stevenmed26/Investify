package services

import (
	"context"
	"fmt"
	"log"
	"os"
	"strings"
	"time"

	"investify/apps/api/internal/marketdata"

	"github.com/jackc/pgx/v5/pgxpool"
)

type PriceIngestionService struct {
	DB                *pgxpool.Pool
	Provider          marketdata.Provider
	CredentialService *CredentialService
	ProviderName      string
}

// IngestBySymbolForUser ingests price history for a specific user's API key.
// Used by the per-user admin endpoints.
func (s *PriceIngestionService) IngestBySymbolForUser(ctx context.Context, userID, symbol string, days int) (int, error) {
	symbol = strings.ToUpper(strings.TrimSpace(symbol))
	if symbol == "" {
		return 0, fmt.Errorf("symbol is required")
	}

	log.Printf("[ingest] start user_id=%s symbol=%s days=%d", userID, symbol, days)

	var tickerID string
	err := s.DB.QueryRow(ctx, `
		SELECT id FROM tickers WHERE symbol = $1
	`, symbol).Scan(&tickerID)
	if err != nil {
		return 0, fmt.Errorf("ticker not found: %w", err)
	}

	var apiKey string
	if s.ProviderName == "twelvedata" {
		if s.CredentialService == nil {
			return 0, fmt.Errorf("credential service not configured")
		}
		apiKey, err = s.CredentialService.GetAPIKey(ctx, userID, "twelvedata")
		if err != nil {
			return 0, fmt.Errorf("fetch user api key: %w", err)
		}
	}

	return s.fetchAndStore(ctx, tickerID, symbol, days, apiKey)
}

// IngestBySymbol ingests price history using the system-level API key from the
// TWELVE_DATA_API_KEY environment variable. Used by the daily scheduler so the
// pipeline doesn't require a specific user to be logged in.
func (s *PriceIngestionService) IngestBySymbol(ctx context.Context, symbol string, days int) (int, error) {
	symbol = strings.ToUpper(strings.TrimSpace(symbol))
	if symbol == "" {
		return 0, fmt.Errorf("symbol is required")
	}

	var tickerID string
	err := s.DB.QueryRow(ctx, `
		SELECT id FROM tickers WHERE symbol = $1
	`, symbol).Scan(&tickerID)
	if err != nil {
		return 0, fmt.Errorf("ticker not found: %w", err)
	}

	// Read API key directly from environment for system-level pipeline runs.
	// This decouples the scheduler from per-user credential storage.
	apiKey := os.Getenv("TWELVE_DATA_API_KEY")
	if s.ProviderName == "twelvedata" && apiKey == "" {
		return 0, fmt.Errorf("TWELVE_DATA_API_KEY env var not set — required for system pipeline")
	}

	return s.fetchAndStore(ctx, tickerID, symbol, days, apiKey)
}

// fetchAndStore is the shared implementation used by both ingest methods.
func (s *PriceIngestionService) fetchAndStore(ctx context.Context, tickerID, symbol string, days int, apiKey string) (int, error) {
	prices, err := s.Provider.FetchDailyHistory(ctx, symbol, days, apiKey)
	if err != nil {
		return 0, fmt.Errorf("fetch history: %w", err)
	}

	log.Printf("[ingest] fetched rows=%d symbol=%s", len(prices), symbol)

	tx, err := s.DB.Begin(ctx)
	if err != nil {
		return 0, fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx)

	inserted := 0
	for _, p := range prices {
		_, err := tx.Exec(ctx, `
			INSERT INTO historical_prices (
				ticker_id, trading_date, open, high, low, close,
				adjusted_close, volume, source, created_at
			)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
			ON CONFLICT (ticker_id, trading_date)
			DO UPDATE SET
				open = EXCLUDED.open, high = EXCLUDED.high,
				low = EXCLUDED.low, close = EXCLUDED.close,
				adjusted_close = EXCLUDED.adjusted_close,
				volume = EXCLUDED.volume, source = EXCLUDED.source
		`,
			tickerID, p.TradingDate, p.Open, p.High, p.Low, p.Close,
			p.AdjustedClose, p.Volume, p.Source, time.Now().UTC(),
		)
		if err != nil {
			return 0, fmt.Errorf("insert price row: %w", err)
		}
		inserted++
	}

	if err := tx.Commit(ctx); err != nil {
		return 0, fmt.Errorf("commit tx: %w", err)
	}

	log.Printf("[ingest] completed symbol=%s inserted_or_updated=%d", symbol, inserted)
	return inserted, nil
}
