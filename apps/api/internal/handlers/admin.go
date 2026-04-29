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

	job, err := h.JobManager.CreateWithPayload(
		"batch_ingest_history",
		"Queued historical ingest job.",
		map[string]any{
			"user_id":  user.UserID,
			"symbols":  symbols,
			"days":     days,
			"delay_ms": delayMS,
		},
		map[string]any{
			"symbol_count": len(symbols),
		},
		3,
	)
	if err != nil {
		log.Printf("[admin] failed enqueueing batch ingest job user_id=%s err=%v", user.UserID, err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to enqueue job"})
		return
	}

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

	job, err := h.JobManager.CreateWithPayload(
		"batch_backfill_features",
		"Queued feature backfill job.",
		map[string]any{
			"user_id": user.UserID,
			"symbols": symbols,
		},
		map[string]any{
			"symbol_count": len(symbols),
		},
		3,
	)
	if err != nil {
		log.Printf("[admin] failed enqueueing feature backfill job user_id=%s err=%v", user.UserID, err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to enqueue job"})
		return
	}

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

func (h AdminHandler) ListJobs(w http.ResponseWriter, r *http.Request) {
	limit := 50
	if raw := r.URL.Query().Get("limit"); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil && parsed > 0 && parsed <= 200 {
			limit = parsed
		}
	}

	jobs, err := h.JobManager.List(r.URL.Query().Get("service"), r.URL.Query().Get("status"), limit)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to fetch jobs"})
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"jobs": jobs,
	})
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
