package scheduler

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"time"

	"investify/apps/api/internal/services"

	"github.com/jackc/pgx/v5/pgxpool"
)

// PipelineConfig holds the configuration for the daily pipeline.
type PipelineConfig struct {
	// RunHour is the UTC hour to run the pipeline (22 = 10pm UTC / ~6pm ET, after market close).
	RunHour       int
	DaysOfHistory int
	MLBaseURL     string
}

type Runner struct {
	cfg            PipelineConfig
	db             *pgxpool.Pool
	priceService   *services.PriceIngestionService
	featureService *services.FeatureEngineeringService
}

func New(
	cfg PipelineConfig,
	db *pgxpool.Pool,
	priceService *services.PriceIngestionService,
	featureService *services.FeatureEngineeringService,
) *Runner {
	return &Runner{
		cfg:            cfg,
		db:             db,
		priceService:   priceService,
		featureService: featureService,
	}
}

// Start launches the background scheduler goroutine.
func (r *Runner) Start(ctx context.Context) {
	log.Printf("[scheduler] starting — daily pipeline at %02d:00 UTC", r.cfg.RunHour)
	for {
		next := nextRunTime(r.cfg.RunHour)
		log.Printf("[scheduler] next run at %s (in %s)",
			next.Format(time.RFC3339), time.Until(next).Round(time.Minute))

		select {
		case <-ctx.Done():
			log.Printf("[scheduler] shutting down")
			return
		case <-time.After(time.Until(next)):
			r.runPipeline(ctx)
		}
	}
}

func nextRunTime(hour int) time.Time {
	now := time.Now().UTC()
	candidate := time.Date(now.Year(), now.Month(), now.Day(), hour, 0, 0, 0, time.UTC)
	if !candidate.After(now) {
		candidate = candidate.Add(24 * time.Hour)
	}
	return candidate
}

func (r *Runner) runPipeline(ctx context.Context) {
	start := time.Now()
	log.Printf("[pipeline] starting daily run")

	tickers, err := r.getActiveTickers(ctx)
	if err != nil {
		log.Printf("[pipeline] ERROR fetching tickers: %v", err)
		return
	}
	log.Printf("[pipeline] processing %d tickers", len(tickers))

	// Ingest price history
	ingestOK, ingestFail := 0, 0
	for _, symbol := range tickers {
		if ctx.Err() != nil {
			log.Printf("[pipeline] context cancelled during ingest")
			return
		}
		rows, err := r.priceService.IngestBySymbol(ctx, symbol, r.cfg.DaysOfHistory)
		if err != nil {
			log.Printf("[pipeline] ingest failed symbol=%s err=%v", symbol, err)
			ingestFail++
		} else {
			log.Printf("[pipeline] ingested symbol=%s rows=%d", symbol, rows)
			ingestOK++
		}
		// Rate-limit: Twelve Data free tier ~8 req/min, 7.5s gives headroom
		select {
		case <-ctx.Done():
			return
		case <-time.After(7500 * time.Millisecond):
		}
	}
	log.Printf("[pipeline] ingest complete ok=%d fail=%d", ingestOK, ingestFail)

	// Backfill features
	featOK, featFail := 0, 0
	for _, symbol := range tickers {
		if ctx.Err() != nil {
			return
		}
		_, err := r.featureService.BackfillBySymbol(ctx, symbol)
		if err != nil {
			log.Printf("[pipeline] backfill failed symbol=%s err=%v", symbol, err)
			featFail++
		} else {
			featOK++
		}
	}
	log.Printf("[pipeline] backfill complete ok=%d fail=%d", featOK, featFail)

	// Trigger ML training
	log.Printf("[pipeline] triggering ML training")
	if err := r.triggerTraining(ctx); err != nil {
		log.Printf("[pipeline] ML training failed: %v", err)
	} else {
		log.Printf("[pipeline] ML training complete")
	}

	log.Printf("[pipeline] daily run finished duration=%s", time.Since(start).Round(time.Second))
}

func (r *Runner) getActiveTickers(ctx context.Context) ([]string, error) {
	rows, err := r.db.Query(ctx, `
		SELECT symbol FROM tickers
		WHERE is_active = TRUE
		ORDER BY symbol ASC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var symbols []string
	for rows.Next() {
		var s string
		if err := rows.Scan(&s); err != nil {
			return nil, err
		}
		symbols = append(symbols, s)
	}
	return symbols, nil
}

func (r *Runner) triggerTraining(ctx context.Context) error {
	tctx, cancel := context.WithTimeout(ctx, 10*time.Minute)
	defer cancel()

	req, err := http.NewRequestWithContext(tctx, http.MethodPost,
		r.cfg.MLBaseURL+"/train?horizon_days=5", nil)
	if err != nil {
		return fmt.Errorf("create request: %w", err)
	}

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return fmt.Errorf("call ML service: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("ML training returned status %d", resp.StatusCode)
	}
	return nil
}
