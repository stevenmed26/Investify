package router

import (
	"net/http"

	"investify/apps/api/internal/clients/mlclient"
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

	ml := mlclient.New(cfg.MLBaseURL)

	tickerHandler := handlers.TickerHandler{
		DB:       db,
		MLClient: ml,
	}

	holdingHandler := handlers.HoldingHandler{
		DB: db,
	}

	r.Get("/health", handlers.Health)

	r.Route("/api/v1", func(r chi.Router) {
		r.Get("/tickers", tickerHandler.ListTickers)
		r.Get("/tickers/{symbol}", tickerHandler.GetTickerBySymbol)
		r.Get("/tickers/{symbol}/prediction", tickerHandler.GetPredictionBySymbol)

		r.Get("/holdings", holdingHandler.ListHoldings)
		r.Post("/holdings", holdingHandler.CreateHolding)
		r.Post("/holdings/by-symbol", holdingHandler.CreateHoldingBySymbol)
	})

	return r
}
