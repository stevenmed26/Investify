package jobs

import (
	"context"
	"fmt"
	"log"
	"strconv"
	"strings"
	"time"

	"investify/apps/api/internal/services"
)

const (
	jobBatchIngestHistory    = "batch_ingest_history"
	jobBatchBackfillFeatures = "batch_backfill_features"
)

type Worker struct {
	ID               string
	Manager          *Manager
	PriceIngestionSV *services.PriceIngestionService
	FeatureSV        *services.FeatureEngineeringService
	PollInterval     time.Duration
}

type itemResult struct {
	Symbol        string `json:"symbol"`
	RowsProcessed int    `json:"rows_processed,omitempty"`
	Error         string `json:"error,omitempty"`
}

func NewWorker(manager *Manager, priceIngestionSV *services.PriceIngestionService, featureSV *services.FeatureEngineeringService) *Worker {
	return &Worker{
		ID:               "api-worker-" + newID()[:8],
		Manager:          manager,
		PriceIngestionSV: priceIngestionSV,
		FeatureSV:        featureSV,
		PollInterval:     2 * time.Second,
	}
}

func (w *Worker) Start(ctx context.Context) {
	if w.Manager == nil {
		log.Printf("[jobs] worker not started: job manager is nil")
		return
	}
	if w.PollInterval <= 0 {
		w.PollInterval = 2 * time.Second
	}

	log.Printf("[jobs] worker started id=%s", w.ID)
	for {
		select {
		case <-ctx.Done():
			log.Printf("[jobs] worker stopped id=%s", w.ID)
			return
		default:
		}

		job, ok, err := w.Manager.ClaimNext(w.ID, []string{jobBatchIngestHistory, jobBatchBackfillFeatures})
		if err != nil {
			log.Printf("[jobs] claim failed worker_id=%s err=%v", w.ID, err)
			sleepOrDone(ctx, w.PollInterval)
			continue
		}
		if !ok {
			sleepOrDone(ctx, w.PollInterval)
			continue
		}

		w.runJob(job)
	}
}

func (w *Worker) runJob(job Job) {
	var err error

	switch job.Name {
	case jobBatchIngestHistory:
		err = w.runBatchIngestJob(job)
	case jobBatchBackfillFeatures:
		err = w.runBatchBackfillJob(job)
	default:
		w.Manager.MarkFailed(job.ID, "Unsupported job type.", "unsupported job type: "+job.Name)
		return
	}

	if err == nil {
		return
	}

	if job.Attempts < job.MaxAttempts {
		delay := time.Duration(job.Attempts) * 30 * time.Second
		if delay <= 0 {
			delay = 30 * time.Second
		}
		w.Manager.MarkRetry(job.ID, "Job failed; retry queued.", err.Error(), delay)
		return
	}

	w.Manager.MarkFailed(job.ID, "Job failed.", err.Error())
}

func (w *Worker) runBatchIngestJob(job Job) error {
	if w.PriceIngestionSV == nil {
		return fmt.Errorf("price ingestion service is not configured")
	}

	userID := stringPayload(job.Payload, "user_id")
	if userID == "" {
		return fmt.Errorf("job payload user_id is required")
	}

	symbols := stringSlicePayload(job.Payload, "symbols")
	if len(symbols) == 0 {
		return fmt.Errorf("job payload symbols are required")
	}

	days := intPayload(job.Payload, "days", 365)
	delayMS := intPayload(job.Payload, "delay_ms", 9000)

	w.Manager.UpdateMessage(job.ID, "Historical ingest job is running.")
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
	defer cancel()

	results := make([]itemResult, 0, len(symbols))
	for i, symbol := range symbols {
		w.Manager.UpdateMessage(job.ID, "Processing "+symbol+" ("+strconv.Itoa(i+1)+"/"+strconv.Itoa(len(symbols))+").")

		rowsProcessed, err := w.PriceIngestionSV.IngestBySymbolForUser(ctx, userID, symbol, days)
		if err != nil {
			log.Printf("[batch-ingest] failed job_id=%s user_id=%s symbol=%s err=%v", job.ID, userID, symbol, err)
			results = append(results, itemResult{Symbol: symbol, Error: err.Error()})
		} else {
			results = append(results, itemResult{Symbol: symbol, RowsProcessed: rowsProcessed})
		}

		if i < len(symbols)-1 && delayMS > 0 {
			select {
			case <-ctx.Done():
				return fmt.Errorf("batch ingest timed out: %w", ctx.Err())
			case <-time.After(time.Duration(delayMS) * time.Millisecond):
			}
		}
	}

	w.Manager.MarkCompleted(job.ID, "Historical ingest job completed.", map[string]any{
		"days":     days,
		"delay_ms": delayMS,
		"results":  results,
	})
	return nil
}

func (w *Worker) runBatchBackfillJob(job Job) error {
	if w.FeatureSV == nil {
		return fmt.Errorf("feature engineering service is not configured")
	}

	userID := stringPayload(job.Payload, "user_id")
	symbols := stringSlicePayload(job.Payload, "symbols")
	if len(symbols) == 0 {
		return fmt.Errorf("job payload symbols are required")
	}

	w.Manager.UpdateMessage(job.ID, "Feature backfill job is running.")
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
	defer cancel()

	results := make([]itemResult, 0, len(symbols))
	for i, symbol := range symbols {
		w.Manager.UpdateMessage(job.ID, "Generating features for "+symbol+" ("+strconv.Itoa(i+1)+"/"+strconv.Itoa(len(symbols))+").")

		count, err := w.FeatureSV.BackfillBySymbol(ctx, symbol)
		if err != nil {
			log.Printf("[batch-backfill] failed job_id=%s user_id=%s symbol=%s err=%v", job.ID, userID, symbol, err)
			results = append(results, itemResult{Symbol: symbol, Error: err.Error()})
		} else {
			results = append(results, itemResult{Symbol: symbol, RowsProcessed: count})
		}
	}

	w.Manager.MarkCompleted(job.ID, "Feature backfill job completed.", map[string]any{
		"results": results,
	})
	return nil
}

func stringPayload(payload map[string]any, key string) string {
	value, ok := payload[key]
	if !ok {
		return ""
	}
	return strings.TrimSpace(fmt.Sprint(value))
}

func intPayload(payload map[string]any, key string, fallback int) int {
	value, ok := payload[key]
	if !ok {
		return fallback
	}

	switch v := value.(type) {
	case int:
		return v
	case int32:
		return int(v)
	case int64:
		return int(v)
	case float64:
		return int(v)
	case jsonNumber:
		if parsed, err := strconv.Atoi(v.String()); err == nil {
			return parsed
		}
	case string:
		if parsed, err := strconv.Atoi(v); err == nil {
			return parsed
		}
	}
	return fallback
}

func stringSlicePayload(payload map[string]any, key string) []string {
	value, ok := payload[key]
	if !ok {
		return nil
	}

	var raw []any
	switch v := value.(type) {
	case []string:
		out := make([]string, 0, len(v))
		for _, item := range v {
			item = strings.ToUpper(strings.TrimSpace(item))
			if item != "" {
				out = append(out, item)
			}
		}
		return out
	case []any:
		raw = v
	default:
		return nil
	}

	out := make([]string, 0, len(raw))
	for _, item := range raw {
		symbol := strings.ToUpper(strings.TrimSpace(fmt.Sprint(item)))
		if symbol != "" {
			out = append(out, symbol)
		}
	}
	return out
}

type jsonNumber interface {
	String() string
}

func sleepOrDone(ctx context.Context, d time.Duration) {
	timer := time.NewTimer(d)
	defer timer.Stop()

	select {
	case <-ctx.Done():
	case <-timer.C:
	}
}
