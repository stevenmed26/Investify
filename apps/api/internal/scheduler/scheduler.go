package scheduler

import (
	"context"
	"log"
	"time"

	"investify/apps/api/internal/jobs"

	"github.com/jackc/pgx/v5/pgxpool"
)

// PipelineConfig holds the configuration for the daily pipeline.
type PipelineConfig struct {
	// RunHour is the UTC hour to run the pipeline (22 = 10pm UTC / ~6pm ET, after market close).
	RunHour       int
	DaysOfHistory int
	MLBaseURL     string
	MLToken       string
}

type Runner struct {
	cfg        PipelineConfig
	db         *pgxpool.Pool
	jobManager *jobs.Manager
}

func New(cfg PipelineConfig, db *pgxpool.Pool) *Runner {
	return &Runner{
		cfg:        cfg,
		db:         db,
		jobManager: jobs.NewManager(db),
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
	if ctx.Err() != nil {
		return
	}

	_, err := r.jobManager.CreateWithPayload(
		"daily_pipeline",
		"Queued scheduled daily pipeline.",
		map[string]any{
			"days":         r.cfg.DaysOfHistory,
			"delay_ms":     7500,
			"horizon_days": 5,
			"source":       "scheduler",
		},
		map[string]any{
			"source":   "scheduler",
			"run_hour": r.cfg.RunHour,
		},
		3,
	)
	if err != nil {
		log.Printf("[pipeline] failed to enqueue daily pipeline: %v", err)
		return
	}
	log.Printf("[pipeline] daily pipeline queued")
}
