package handlers

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"strings"
	"time"

	"investify/apps/api/internal/clients/mlclient"
	"investify/apps/api/internal/models"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type TickerHandler struct {
	DB       *pgxpool.Pool
	MLClient *mlclient.Client
}

func (h TickerHandler) ListTickers(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	rows, err := h.DB.Query(ctx, `
		SELECT id, symbol, company_name, COALESCE(exchange, ''), is_active
		FROM tickers
		ORDER BY symbol ASC
	`)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to fetch tickers"})
		return
	}
	defer rows.Close()

	tickers := make([]models.Ticker, 0)
	for rows.Next() {
		var t models.Ticker
		if err := rows.Scan(&t.ID, &t.Symbol, &t.CompanyName, &t.Exchange, &t.IsActive); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to scan tickers"})
			return
		}
		tickers = append(tickers, t)
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"tickers": tickers,
	})
}

func (h TickerHandler) GetTickerBySymbol(w http.ResponseWriter, r *http.Request) {
	symbol := strings.ToUpper(strings.TrimSpace(chi.URLParam(r, "symbol")))
	if symbol == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "symbol is required"})
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	var t models.Ticker
	err := h.DB.QueryRow(ctx, `
		SELECT id, symbol, company_name, COALESCE(exchange, ''), is_active
		FROM tickers
		WHERE symbol = $1
	`, symbol).Scan(&t.ID, &t.Symbol, &t.CompanyName, &t.Exchange, &t.IsActive)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "ticker not found"})
		return
	}

	writeJSON(w, http.StatusOK, t)
}

func (h TickerHandler) GetPredictionBySymbol(w http.ResponseWriter, r *http.Request) {
	symbol := strings.ToUpper(strings.TrimSpace(chi.URLParam(r, "symbol")))
	if symbol == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "symbol is required"})
		return
	}

	horizonDays := 5
	if raw := r.URL.Query().Get("horizon_days"); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil && parsed > 0 {
			horizonDays = parsed
		}
	}

	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()

	prediction, err := h.MLClient.Predict(ctx, symbol, horizonDays)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "failed to fetch prediction"})
		return
	}

	writeJSON(w, http.StatusOK, prediction)
}

// BulkUpsertTickers inserts or updates a list of tickers by symbol.
// Uses ON CONFLICT (symbol) DO UPDATE so it is safe to call repeatedly —
// re-adding an existing ticker just refreshes its name and exchange.
// Symbols are normalised to uppercase and trimmed before insert.
func (h TickerHandler) BulkUpsertTickers(w http.ResponseWriter, r *http.Request) {
	var req models.BulkUpsertTickersRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}

	if len(req.Tickers) == 0 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "tickers array is required and must not be empty"})
		return
	}

	if len(req.Tickers) > 500 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "maximum 500 tickers per request"})
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()

	type itemResult struct {
		Symbol string `json:"symbol"`
		Action string `json:"action"` // "inserted" | "updated"
		Error  string `json:"error,omitempty"`
	}

	results := make([]itemResult, 0, len(req.Tickers))
	inserted := 0
	updated := 0

	for _, t := range req.Tickers {
		symbol := strings.ToUpper(strings.TrimSpace(t.Symbol))
		companyName := strings.TrimSpace(t.CompanyName)
		exchange := strings.TrimSpace(t.Exchange)

		if symbol == "" || companyName == "" {
			results = append(results, itemResult{
				Symbol: symbol,
				Error:  "symbol and company_name are required",
			})
			continue
		}

		// Use xmax to detect whether the row was inserted or updated.
		// xmax = 0 means the row is newly inserted; non-zero means it was updated.
		var action string
		var xmax uint32
		err := h.DB.QueryRow(ctx, `
			INSERT INTO tickers (symbol, company_name, exchange, is_active, created_at, updated_at)
			VALUES ($1, $2, $3, TRUE, NOW(), NOW())
			ON CONFLICT (symbol) DO UPDATE SET
				company_name = EXCLUDED.company_name,
				exchange     = EXCLUDED.exchange,
				is_active    = TRUE,
				updated_at   = NOW()
			RETURNING xmax
		`, symbol, companyName, exchange).Scan(&xmax)

		if err != nil {
			log.Printf("[tickers] upsert failed symbol=%s err=%v", symbol, err)
			results = append(results, itemResult{Symbol: symbol, Error: "upsert failed"})
			continue
		}

		if xmax == 0 {
			action = "inserted"
			inserted++
		} else {
			action = "updated"
			updated++
		}

		results = append(results, itemResult{Symbol: symbol, Action: action})
	}

	log.Printf("[tickers] bulk upsert complete inserted=%d updated=%d errors=%d",
		inserted, updated, len(req.Tickers)-inserted-updated)

	writeJSON(w, http.StatusOK, map[string]any{
		"inserted": inserted,
		"updated":  updated,
		"results":  results,
	})
}
