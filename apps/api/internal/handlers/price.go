package handlers

import (
	"context"
	"net/http"
	"strconv"
	"strings"
	"time"

	"investify/apps/api/internal/models"
	"investify/apps/api/internal/services"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type PriceHandler struct {
	DB               *pgxpool.Pool
	PriceIngestionSV *services.PriceIngestionService
}

func (h PriceHandler) GetHistoricalPricesBySymbol(w http.ResponseWriter, r *http.Request) {
	symbol := strings.ToUpper(strings.TrimSpace(chi.URLParam(r, "symbol")))
	if symbol == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "symbol is required"})
		return
	}

	limit := 180
	if raw := r.URL.Query().Get("limit"); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil && parsed > 0 && parsed <= 1000 {
			limit = parsed
		}
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	rows, err := h.DB.Query(ctx, `
		SELECT
			hp.trading_date::text,
			hp.open,
			hp.high,
			hp.low,
			hp.close,
			COALESCE(hp.adjusted_close, hp.close),
			hp.volume,
			hp.source
		FROM historical_prices hp
		JOIN tickers t ON t.id = hp.ticker_id
		WHERE t.symbol = $1
		ORDER BY hp.trading_date DESC
		LIMIT $2
	`, symbol, limit)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to fetch prices"})
		return
	}
	defer rows.Close()

	prices := make([]models.HistoricalPrice, 0)
	for rows.Next() {
		var item models.HistoricalPrice
		if err := rows.Scan(
			&item.TradingDate,
			&item.Open,
			&item.High,
			&item.Low,
			&item.Close,
			&item.AdjustedClose,
			&item.Volume,
			&item.Source,
		); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to scan prices"})
			return
		}
		prices = append(prices, item)
	}

	// Reverse to ascending order for charting
	for i, j := 0, len(prices)-1; i < j; i, j = i+1, j-1 {
		prices[i], prices[j] = prices[j], prices[i]
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"symbol": symbol,
		"prices": prices,
	})
}

func (h PriceHandler) IngestHistoricalPricesBySymbol(w http.ResponseWriter, r *http.Request) {
	symbol := strings.ToUpper(strings.TrimSpace(chi.URLParam(r, "symbol")))
	if symbol == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "symbol is required"})
		return
	}

	days := 180
	if raw := r.URL.Query().Get("days"); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil && parsed > 0 && parsed <= 5000 {
			days = parsed
		}
	}

	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()

	count, err := h.PriceIngestionSV.IngestBySymbol(ctx, symbol, days)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"symbol":         symbol,
		"rows_processed": count,
	})
}
