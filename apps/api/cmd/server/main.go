package main

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"investify/apps/api/internal/config"
	"investify/apps/api/internal/db"
	"investify/apps/api/internal/marketdata"
	"investify/apps/api/internal/router"
	"investify/apps/api/internal/scheduler"
	"investify/apps/api/internal/security"
	"investify/apps/api/internal/services"

	"github.com/jackc/pgx/v5/pgxpool"
)

func main() {
	cfg := config.Load()

	pool, err := db.NewPostgresPool(cfg)
	if err != nil {
		log.Fatalf("failed to connect to database: %v", err)
	}
	defer pool.Close()

	// Sync the ticker registry from apps/data/tickers.json into the DB on startup.
	// Idempotent — uses ON CONFLICT DO UPDATE so re-running is always safe.
	if err := syncTickerRegistry(pool); err != nil {
		log.Printf("WARNING: ticker registry sync failed: %v", err)
	}

	// Build services
	encryptor := security.NewEncryptor(cfg.AppEncryptionKey)
	credentialService := &services.CredentialService{
		DB:        pool,
		Encryptor: encryptor,
	}

	providerName := os.Getenv("MARKET_DATA_PROVIDER")
	twelveDataBaseURL := os.Getenv("TWELVE_DATA_BASE_URL")
	var provider marketdata.Provider
	if providerName == "twelvedata" {
		log.Printf("[marketdata] provider=twelvedata")
		provider = marketdata.NewTwelveDataProvider(twelveDataBaseURL)
	} else {
		log.Printf("[marketdata] provider=dev-synthetic")
		provider = marketdata.NewDevProvider()
		providerName = "dev"
	}

	priceService := &services.PriceIngestionService{
		DB:                pool,
		Provider:          provider,
		CredentialService: credentialService,
		ProviderName:      providerName,
	}
	featureService := &services.FeatureEngineeringService{DB: pool}

	r := router.New(cfg, pool)

	// Graceful shutdown
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGTERM, syscall.SIGINT)
	defer stop()

	// Start daily pipeline scheduler in background
	sched := scheduler.New(
		scheduler.PipelineConfig{
			RunHour:       22, // 10pm UTC ≈ 6pm ET, after US market close
			DaysOfHistory: 365,
			MLBaseURL:     cfg.MLBaseURL,
		},
		pool,
		priceService,
		featureService,
	)
	go sched.Start(ctx)

	// HTTP server
	srv := &http.Server{Addr: ":" + cfg.Port, Handler: r}
	go func() {
		log.Printf("api listening on :%s", cfg.Port)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("server failed: %v", err)
		}
	}()

	<-ctx.Done()
	log.Printf("shutting down...")
	shutCtx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	_ = srv.Shutdown(shutCtx)
}

type tickerEntry struct {
	Symbol   string `json:"symbol"`
	Name     string `json:"name"`
	Exchange string `json:"exchange"`
	Sector   string `json:"sector"`
}

type tickerRegistry struct {
	Tickers []tickerEntry `json:"tickers"`
}

func syncTickerRegistry(pool *pgxpool.Pool) error {
	path := os.Getenv("TICKER_REGISTRY_PATH")
	if path == "" {
		path = "/app/data/tickers.json"
	}

	data, err := os.ReadFile(path)
	if err != nil {
		return err
	}

	var registry tickerRegistry
	if err := json.Unmarshal(data, &registry); err != nil {
		return err
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	inserted, updated := 0, 0
	for _, t := range registry.Tickers {
		symbol := strings.ToUpper(strings.TrimSpace(t.Symbol))
		if symbol == "" || t.Name == "" {
			continue
		}
		tag, err := pool.Exec(ctx, `
			INSERT INTO tickers (symbol, company_name, exchange, sector, is_active, created_at, updated_at)
			VALUES ($1, $2, $3, $4, TRUE, NOW(), NOW())
			ON CONFLICT (symbol) DO UPDATE SET
				company_name = EXCLUDED.company_name,
				exchange     = EXCLUDED.exchange,
				sector       = COALESCE(EXCLUDED.sector, tickers.sector),
				is_active    = TRUE,
				updated_at   = NOW()
		`, symbol, t.Name, t.Exchange, t.Sector)
		if err != nil {
			log.Printf("[registry] failed symbol=%s err=%v", symbol, err)
			continue
		}
		if tag.RowsAffected() == 1 && strings.Contains(tag.String(), "INSERT") {
			inserted++
		} else {
			updated++
		}
	}
	log.Printf("[registry] synced tickers inserted=%d updated=%d", inserted, updated)
	return nil
}
