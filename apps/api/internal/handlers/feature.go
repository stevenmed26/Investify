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

type FeatureHandler struct {
	DB        *pgxpool.Pool
	FeatureSV *services.FeatureEngineeringService
}

func (h FeatureHandler) BackfillFeaturesBySymbol(w http.ResponseWriter, r *http.Request) {
	symbol := strings.ToUpper(strings.TrimSpace(chi.URLParam(r, "symbol")))
	if symbol == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "symbol is required"})
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()

	count, err := h.FeatureSV.BackfillBySymbol(ctx, symbol)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"symbol":         symbol,
		"rows_processed": count,
	})
}

func (h FeatureHandler) GetFeaturesBySymbol(w http.ResponseWriter, r *http.Request) {
	symbol := strings.ToUpper(strings.TrimSpace(chi.URLParam(r, "symbol")))
	if symbol == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "symbol is required"})
		return
	}

	limit := 30
	if raw := r.URL.Query().Get("limit"); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil && parsed > 0 && parsed <= 1000 {
			limit = parsed
		}
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	rows, err := h.DB.Query(ctx, `
		SELECT
			tf.trading_date::text,
			tf.sma_20,
			tf.sma_50,
			tf.ema_12,
			tf.ema_26,
			tf.rsi_14,
			tf.macd,
			tf.momentum_5d,
			tf.momentum_20d,
			tf.volatility_20d
		FROM technical_features tf
		JOIN tickers t ON t.id = tf.ticker_id
		WHERE t.symbol = $1
		ORDER BY tf.trading_date DESC
		LIMIT $2
	`, symbol, limit)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to fetch features"})
		return
	}
	defer rows.Close()

	items := make([]models.TechnicalFeature, 0)
	for rows.Next() {
		var item models.TechnicalFeature
		if err := rows.Scan(
			&item.TradingDate,
			&item.SMA20,
			&item.SMA50,
			&item.EMA12,
			&item.EMA26,
			&item.RSI14,
			&item.MACD,
			&item.Momentum5D,
			&item.Momentum20D,
			&item.Volatility20D,
		); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to scan features"})
			return
		}
		items = append(items, item)
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"symbol":   symbol,
		"features": items,
	})
}
