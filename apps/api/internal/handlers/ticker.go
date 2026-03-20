package handlers

import (
	"context"
	"net/http"
	"strconv"
	"strings"
	"time"

	"investify/apps/api/internal/clients/mlclient"
	"investify/apps/api/internal/models"

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
