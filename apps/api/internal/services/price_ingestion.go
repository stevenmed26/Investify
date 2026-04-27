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
	fetchDays, err := s.daysToFetch(ctx, tickerID, days)
	if err != nil {
		return 0, err
	}
	if fetchDays == 0 {
		log.Printf("[ingest] skip symbol=%s reason=history_current", symbol)
		return 0, nil
	}

	prices, err := s.Provider.FetchDailyHistory(ctx, symbol, fetchDays, apiKey)
	if err != nil {
		return 0, fmt.Errorf("fetch history: %w", err)
	}

	log.Printf("[ingest] fetched rows=%d symbol=%s requested_days=%d fetch_days=%d", len(prices), symbol, days, fetchDays)

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

func (s *PriceIngestionService) daysToFetch(ctx context.Context, tickerID string, requestedDays int) (int, error) {
	if requestedDays <= 0 {
		requestedDays = 365
	}

	var rowCount int
	var latest time.Time
	if err := s.DB.QueryRow(ctx, `
		SELECT COUNT(*), COALESCE(MAX(trading_date), DATE '1970-01-01')
		FROM historical_prices
		WHERE ticker_id = $1
	`, tickerID).Scan(&rowCount, &latest); err != nil {
		return 0, fmt.Errorf("check existing history: %w", err)
	}

	if rowCount == 0 {
		return requestedDays, nil
	}

	missingTradingDays := countTradingDaysAfter(latest, expectedLatestTradingDate(time.Now().UTC()))
	if missingTradingDays <= 0 {
		return 0, nil
	}

	const overlapDays = 5
	fetchDays := missingTradingDays + overlapDays
	if fetchDays > requestedDays {
		return requestedDays, nil
	}
	return fetchDays, nil
}

func expectedLatestTradingDate(now time.Time) time.Time {
	date := dateOnly(now)
	for date.Weekday() == time.Saturday || date.Weekday() == time.Sunday {
		date = date.AddDate(0, 0, -1)
	}
	return date
}

func countTradingDaysAfter(latest, target time.Time) int {
	count := 0
	for d := dateOnly(latest).AddDate(0, 0, 1); !d.After(dateOnly(target)); d = d.AddDate(0, 0, 1) {
		if d.Weekday() != time.Saturday && d.Weekday() != time.Sunday {
			count++
		}
	}
	return count
}

func dateOnly(t time.Time) time.Time {
	y, m, d := t.Date()
	return time.Date(y, m, d, 0, 0, 0, 0, time.UTC)
}
