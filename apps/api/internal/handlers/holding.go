package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"investify/apps/api/internal/middleware"
	"investify/apps/api/internal/models"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type HoldingHandler struct {
	DB *pgxpool.Pool
}

// ListHoldings returns only the authenticated user's holdings.
func (h HoldingHandler) ListHoldings(w http.ResponseWriter, r *http.Request) {
	user, ok := middleware.GetAuthUser(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	rows, err := h.DB.Query(ctx, `
		SELECT
			h.id, h.user_id, h.ticker_id,
			t.symbol, t.company_name,
			h.shares_owned, h.average_cost_basis
		FROM holdings h
		JOIN tickers t ON t.id = h.ticker_id
		WHERE h.user_id = $1
		ORDER BY t.symbol ASC
	`, user.UserID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to fetch holdings"})
		return
	}
	defer rows.Close()

	holdings := make([]models.Holding, 0)
	for rows.Next() {
		var item models.Holding
		if err := rows.Scan(
			&item.ID, &item.UserID, &item.TickerID,
			&item.Symbol, &item.CompanyName,
			&item.SharesOwned, &item.AverageCostBasis,
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

// CreateHolding is kept for backwards compatibility but always uses the JWT user.
func (h HoldingHandler) CreateHolding(w http.ResponseWriter, r *http.Request) {
	user, ok := middleware.GetAuthUser(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}

	var req models.CreateHoldingRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}

	if req.TickerID == "" || req.SharesOwned < 0 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "ticker_id and valid shares_owned required"})
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	id, err := h.upsertHolding(ctx, user.UserID, req.TickerID, req.SharesOwned, req.AverageCostBasis)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to save holding"})
		return
	}

	writeJSON(w, http.StatusCreated, map[string]any{"id": id})
}

// CreateHoldingBySymbol adds or upserts a holding for the authenticated user.
// user_id is always taken from the JWT, never trusted from the body.
func (h HoldingHandler) CreateHoldingBySymbol(w http.ResponseWriter, r *http.Request) {
	user, ok := middleware.GetAuthUser(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}

	var req models.CreateHoldingBySymbolRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}

	req.Symbol = strings.ToUpper(strings.TrimSpace(req.Symbol))
	if req.Symbol == "" || req.SharesOwned < 0 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "symbol and valid shares_owned required"})
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	var tickerID string
	err := h.DB.QueryRow(ctx, `SELECT id FROM tickers WHERE symbol = $1`, req.Symbol).Scan(&tickerID)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "ticker not found"})
		return
	}

	id, err := h.upsertHolding(ctx, user.UserID, tickerID, req.SharesOwned, req.AverageCostBasis)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to save holding"})
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"id": id, "ticker_id": tickerID, "symbol": req.Symbol,
	})
}

// DeleteHolding removes a holding owned by the authenticated user.
func (h HoldingHandler) DeleteHolding(w http.ResponseWriter, r *http.Request) {
	user, ok := middleware.GetAuthUser(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}

	holdingID := chi.URLParam(r, "id")
	if holdingID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "id is required"})
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	tag, err := h.DB.Exec(ctx, `
		DELETE FROM holdings
		WHERE id = $1 AND user_id = $2
	`, holdingID, user.UserID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to delete holding"})
		return
	}

	if tag.RowsAffected() == 0 {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "holding not found"})
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{"status": "deleted"})
}

func (h HoldingHandler) upsertHolding(ctx context.Context, userID, tickerID string, sharesOwned float64, averageCostBasis *float64) (string, error) {
	var id string
	err := h.DB.QueryRow(ctx, `
		INSERT INTO holdings (user_id, ticker_id, shares_owned, average_cost_basis)
		VALUES ($1, $2, $3, $4)
		ON CONFLICT (user_id, ticker_id)
		DO UPDATE SET
			shares_owned = holdings.shares_owned + EXCLUDED.shares_owned,
			average_cost_basis = CASE
				WHEN holdings.average_cost_basis IS NULL THEN EXCLUDED.average_cost_basis
				WHEN EXCLUDED.average_cost_basis IS NULL THEN holdings.average_cost_basis
				WHEN holdings.shares_owned + EXCLUDED.shares_owned = 0 THEN NULL
				ELSE (
					(holdings.shares_owned * holdings.average_cost_basis) +
					(EXCLUDED.shares_owned * EXCLUDED.average_cost_basis)
				) / (holdings.shares_owned + EXCLUDED.shares_owned)
			END,
			updated_at = NOW()
		RETURNING id
	`, userID, tickerID, sharesOwned, averageCostBasis).Scan(&id)
	return id, err
}
