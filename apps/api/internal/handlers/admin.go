package handlers

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"strconv"
	"time"

	"investify/apps/api/internal/middleware"
	"investify/apps/api/internal/services"

	"github.com/jackc/pgx/v5/pgxpool"
)

type AdminHandler struct {
	DB                *pgxpool.Pool
	CredentialService *services.CredentialService
	PriceIngestionSV  *services.PriceIngestionService
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
		writeJSON(w, http.StatusInternalServerError, map[string]string{
			"error": "failed to store api key",
		})
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

	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Minute)
	defer cancel()

	delayMS := 8000
	if raw := r.URL.Query().Get("delay_ms"); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil && parsed >= 0 {
			delayMS = parsed
		}
	}

	days := 180
	if raw := r.URL.Query().Get("days"); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil && parsed > 0 && parsed <= 5000 {
			days = parsed
		}
	}

	var req batchIngestRequest
	_ = json.NewDecoder(r.Body).Decode(&req)

	symbols := req.Symbols
	if len(symbols) == 0 {
		rows, err := h.DB.Query(ctx, `
			SELECT symbol
			FROM tickers
			WHERE is_active = TRUE
			ORDER BY symbol ASC
		`)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to fetch active tickers"})
			return
		}
		defer rows.Close()

		for rows.Next() {
			var symbol string
			if err := rows.Scan(&symbol); err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to scan active ticker"})
				return
			}
			symbols = append(symbols, symbol)
		}
	}

	log.Printf("[batch-ingest] start user_id=%s symbols=%d days=%d delay_ms=%d", user.UserID, len(symbols), days, delayMS)

	type itemResult struct {
		Symbol        string `json:"symbol"`
		RowsProcessed int    `json:"rows_processed,omitempty"`
		Error         string `json:"error,omitempty"`
	}

	results := make([]itemResult, 0, len(symbols))

	for i, symbol := range symbols {
		log.Printf("[batch-ingest] processing user_id=%s index=%d/%d symbol=%s", user.UserID, i+1, len(symbols), symbol)

		rowsProcessed, err := h.PriceIngestionSV.IngestBySymbolForUser(ctx, user.UserID, symbol, days)
		if err != nil {
			log.Printf("[batch-ingest] failed user_id=%s symbol=%s err=%v", user.UserID, symbol, err)
			results = append(results, itemResult{
				Symbol: symbol,
				Error:  err.Error(),
			})
		} else {
			results = append(results, itemResult{
				Symbol:        symbol,
				RowsProcessed: rowsProcessed,
			})
		}

		if i < len(symbols)-1 && delayMS > 0 {
			select {
			case <-ctx.Done():
				writeJSON(w, http.StatusGatewayTimeout, map[string]any{
					"error":   "batch ingest timed out",
					"results": results,
				})
				return
			case <-time.After(time.Duration(delayMS) * time.Millisecond):
			}
		}
	}

	log.Printf("[batch-ingest] completed user_id=%s symbols=%d", user.UserID, len(symbols))

	writeJSON(w, http.StatusOK, map[string]any{
		"status":   "ok",
		"days":     days,
		"delay_ms": delayMS,
		"results":  results,
	})
}
