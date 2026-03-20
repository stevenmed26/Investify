package handlers

import (
	"context"
	"net/http"
	"time"

	"investify/apps/api/internal/models"

	"github.com/jackc/pgx/v5/pgxpool"
)

type TickerHandler struct {
	DB *pgxpool.Pool
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
