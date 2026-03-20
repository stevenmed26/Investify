package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"investify/apps/api/internal/models"

	"github.com/jackc/pgx/v5/pgxpool"
)

type HoldingHandler struct {
	DB *pgxpool.Pool
}

func (h HoldingHandler) ListHoldings(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	rows, err := h.DB.Query(ctx, `
		SELECT
			h.id,
			h.user_id,
			h.ticker_id,
			t.symbol,
			t.company_name,
			h.shares_owned,
			h.average_cost_basis
		FROM holdings h
		JOIN tickers t ON t.id = h.ticker_id
		ORDER BY t.symbol ASC
	`)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to fetch holdings"})
		return
	}
	defer rows.Close()

	holdings := make([]models.Holding, 0)
	for rows.Next() {
		var item models.Holding
		if err := rows.Scan(
			&item.ID,
			&item.UserID,
			&item.TickerID,
			&item.Symbol,
			&item.CompanyName,
			&item.SharesOwned,
			&item.AverageCostBasis,
		); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to scan holdings"})
			return
		}
		holdings = append(holdings, item)
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"holdings": holdings,
	})
}

func (h HoldingHandler) CreateHolding(w http.ResponseWriter, r *http.Request) {
	var req models.CreateHoldingRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}

	if req.UserID == "" || req.TickerID == "" || req.SharesOwned < 0 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "missing or invalid fields"})
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	var id string
	err := h.DB.QueryRow(ctx, `
		INSERT INTO holdings (user_id, ticker_id, shares_owned, average_cost_basis)
		VALUES ($1, $2, $3, $4)
		RETURNING id
	`, req.UserID, req.TickerID, req.SharesOwned, req.AverageCostBasis).Scan(&id)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to create holding"})
		return
	}

	writeJSON(w, http.StatusCreated, map[string]any{
		"id": id,
	})
}

func (h HoldingHandler) CreateHoldingBySymbol(w http.ResponseWriter, r *http.Request) {
	var req models.CreateHoldingBySymbolRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}

	req.Symbol = strings.ToUpper(strings.TrimSpace(req.Symbol))

	if req.UserID == "" || req.Symbol == "" || req.SharesOwned < 0 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "missing or invalid fields"})
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	var tickerID string
	err := h.DB.QueryRow(ctx, `
		SELECT id
		FROM tickers
		WHERE symbol = $1
	`, req.Symbol).Scan(&tickerID)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "ticker not found"})
		return
	}

	var id string
	err = h.DB.QueryRow(ctx, `
		INSERT INTO holdings (user_id, ticker_id, shares_owned, average_cost_basis)
		VALUES ($1, $2, $3, $4)
		RETURNING id
	`, req.UserID, tickerID, req.SharesOwned, req.AverageCostBasis).Scan(&id)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to create holding"})
		return
	}

	writeJSON(w, http.StatusCreated, map[string]any{
		"id":        id,
		"ticker_id": tickerID,
		"symbol":    req.Symbol,
	})
}
