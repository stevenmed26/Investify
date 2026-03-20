package router

import (
	"net/http"

	"investify/apps/api/internal/config"
	"investify/apps/api/internal/handlers"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/cors"
	"github.com/jackc/pgx/v5/pgxpool"
)

func New(cfg config.Config, db *pgxpool.Pool) http.Handler {
	r := chi.NewRouter()

	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   []string{"http://localhost:3000"},
		AllowedMethods:   []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type"},
		AllowCredentials: true,
	}))

	tickerHandler := handlers.TickerHandler{DB: db}
	holdingHandler := handlers.HoldingHandler{DB: db}

	r.Get("/health", handlers.Health)

	r.Route("/api/v1", func(r chi.Router) {
		r.Get("/tickers", tickerHandler.ListTickers)
		r.Get("/holdings", holdingHandler.ListHoldings)
		r.Post("/holdings", holdingHandler.CreateHolding)
	})

	return r
}
