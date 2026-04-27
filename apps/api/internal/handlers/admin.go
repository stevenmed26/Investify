package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"time"

	"investify/apps/api/internal/jobs"
	"investify/apps/api/internal/middleware"
	"investify/apps/api/internal/services"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type AdminHandler struct {
	DB                *pgxpool.Pool
	CredentialService *services.CredentialService
	PriceIngestionSV  *services.PriceIngestionService
	JobManager        *jobs.Manager
}

type setTwelveDataKeyRequest struct {
	APIKey string `json:"api_key"`
}

type batchIngestRequest struct {
	Symbols []string `json:"symbols"`
}

func (h AdminHandler) SetTwelveDataAPIKey(w http.ResponseWriter, r *http.Request) {
	user, ok := middleware.GetAuthUser(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}

	var req setTwelveDataKeyRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}

	if req.APIKey == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "api_key is required"})
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	if err := h.CredentialService.UpsertAPIKey(ctx, user.UserID, "twelvedata", req.APIKey); err != nil {
		log.Printf("[admin] failed storing Twelve Data API key user_id=%s err=%v", user.UserID, err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to store api key"})
		return
	}

	log.Printf("[admin] Twelve Data API key stored user_id=%s", user.UserID)

	writeJSON(w, http.StatusOK, map[string]any{
		"status": "ok",
		"stored": true,
	})
}

func (h AdminHandler) GetProviderStatus(w http.ResponseWriter, r *http.Request) {
	user, ok := middleware.GetAuthUser(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	hasKey, err := h.CredentialService.HasAPIKey(ctx, user.UserID, "twelvedata")
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to check provider status"})
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"provider":           "twelvedata",
		"api_key_configured": hasKey,
	})
}

func (h AdminHandler) BatchIngestHistory(w http.ResponseWriter, r *http.Request) {
	user, ok := middleware.GetAuthUser(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}

	delayMS := 9000
	if raw := r.URL.Query().Get("delay_ms"); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil && parsed >= 0 {
			delayMS = parsed
		}
	}

	days := 365
	if raw := r.URL.Query().Get("days"); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil && parsed > 0 && parsed <= 5000 {
			days = parsed
		}
	}

	var req batchIngestRequest
	_ = json.NewDecoder(r.Body).Decode(&req)

	symbols, err := h.resolveSymbols(context.Background(), req.Symbols)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	job := h.JobManager.Create("batch_ingest_history", "Queued historical ingest job.")
	go h.runBatchIngestJob(job.ID, user.UserID, symbols, days, delayMS)

	writeJSON(w, http.StatusAccepted, map[string]any{
		"job_id":       job.ID,
		"status":       job.Status,
		"days":         days,
		"delay_ms":     delayMS,
		"symbol_count": len(symbols),
	})
}

func (h AdminHandler) BatchBackfillFeatures(w http.ResponseWriter, r *http.Request) {
	user, ok := middleware.GetAuthUser(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}

	symbols, err := h.resolveSymbols(context.Background(), nil)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	job := h.JobManager.Create("batch_backfill_features", "Queued feature backfill job.")
	go h.runBatchBackfillJob(job.ID, user.UserID, symbols)

	writeJSON(w, http.StatusAccepted, map[string]any{
		"job_id":       job.ID,
		"status":       job.Status,
		"symbol_count": len(symbols),
	})
}

func (h AdminHandler) GetJobStatus(w http.ResponseWriter, r *http.Request) {
	jobID := chi.URLParam(r, "jobID")
	job, ok := h.JobManager.Get(jobID)
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "job not found"})
		return
	}

	writeJSON(w, http.StatusOK, job)
}

func (h AdminHandler) resolveSymbols(ctx context.Context, requested []string) ([]string, error) {
	if len(requested) > 0 {
		return requested, nil
	}

	rows, err := h.DB.Query(ctx, `
		SELECT symbol
		FROM tickers
		WHERE is_active = TRUE
		ORDER BY symbol ASC
	`)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch active tickers")
	}
	defer rows.Close()

	symbols := make([]string, 0)
	for rows.Next() {
		var symbol string
		if err := rows.Scan(&symbol); err != nil {
			return nil, fmt.Errorf("failed to scan active ticker")
		}
		symbols = append(symbols, symbol)
	}

	return symbols, nil
}

func (h AdminHandler) runBatchIngestJob(jobID, userID string, symbols []string, days, delayMS int) {
	h.JobManager.MarkRunning(jobID, "Historical ingest job is running.")

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Minute)
	defer cancel()

	type itemResult struct {
		Symbol        string `json:"symbol"`
		RowsProcessed int    `json:"rows_processed,omitempty"`
		Error         string `json:"error,omitempty"`
	}

	results := make([]itemResult, 0, len(symbols))

	for i, symbol := range symbols {
		h.JobManager.UpdateMessage(jobID, "Processing "+symbol+" ("+strconv.Itoa(i+1)+"/"+strconv.Itoa(len(symbols))+").")

		rowsProcessed, err := h.PriceIngestionSV.IngestBySymbolForUser(ctx, userID, symbol, days)
		if err != nil {
			log.Printf("[batch-ingest] failed user_id=%s symbol=%s err=%v", userID, symbol, err)
			results = append(results, itemResult{Symbol: symbol, Error: err.Error()})
		} else {
			results = append(results, itemResult{Symbol: symbol, RowsProcessed: rowsProcessed})
		}

		if i < len(symbols)-1 && delayMS > 0 {
			select {
			case <-ctx.Done():
				h.JobManager.MarkFailed(jobID, "Historical ingest job timed out.", "batch ingest timed out")
				return
			case <-time.After(time.Duration(delayMS) * time.Millisecond):
			}
		}
	}

	h.JobManager.MarkCompleted(jobID, "Historical ingest job completed.", map[string]any{
		"days":     days,
		"delay_ms": delayMS,
		"results":  results,
	})
}

func (h AdminHandler) runBatchBackfillJob(jobID, userID string, symbols []string) {
	h.JobManager.MarkRunning(jobID, "Feature backfill job is running.")

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()

	type itemResult struct {
		Symbol        string `json:"symbol"`
		RowsProcessed int    `json:"rows_processed,omitempty"`
		Error         string `json:"error,omitempty"`
	}

	results := make([]itemResult, 0, len(symbols))

	featureSV := services.FeatureEngineeringService{DB: h.DB}

	for i, symbol := range symbols {
		h.JobManager.UpdateMessage(jobID, "Generating features for "+symbol+" ("+strconv.Itoa(i+1)+"/"+strconv.Itoa(len(symbols))+").")

		count, err := featureSV.BackfillBySymbol(ctx, symbol)
		if err != nil {
			log.Printf("[batch-backfill] failed user_id=%s symbol=%s err=%v", userID, symbol, err)
			results = append(results, itemResult{Symbol: symbol, Error: err.Error()})
		} else {
			results = append(results, itemResult{Symbol: symbol, RowsProcessed: count})
		}
	}

	h.JobManager.MarkCompleted(jobID, "Feature backfill job completed.", map[string]any{
		"results": results,
	})
}
