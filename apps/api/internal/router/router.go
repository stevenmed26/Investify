package router

import (
	"log"
	"net/http"
	"os"

	"investify/apps/api/internal/auth"
	"investify/apps/api/internal/clients/mlclient"
	"investify/apps/api/internal/config"
	"investify/apps/api/internal/handlers"
	"investify/apps/api/internal/marketdata"
	authmw "investify/apps/api/internal/middleware"
	"investify/apps/api/internal/security"
	"investify/apps/api/internal/services"

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

	jwtManager := auth.NewJWTManager(cfg.JWTSecret)
	encryptor := security.NewEncryptor(cfg.AppEncryptionKey)
	credentialService := &services.CredentialService{
		DB:        db,
		Encryptor: encryptor,
	}
	ml := mlclient.New(cfg.MLBaseURL)

	providerName := os.Getenv("MARKET_DATA_PROVIDER")
	twelveDataBaseURL := os.Getenv("TWELVE_DATA_BASE_URL")
	var provider marketdata.Provider
	if providerName == "twelvedata" {
		log.Printf("[marketdata] provider=twelvedata")
		provider = marketdata.NewTwelveDataProvider(twelveDataBaseURL)
	} else {
		log.Printf("[marketdata] provider=dev-synthetic")
		provider = marketdata.NewDevProvider()
		providerName = "dev"
	}

	priceIngestionService := &services.PriceIngestionService{
		DB:                db,
		Provider:          provider,
		CredentialService: credentialService,
		ProviderName:      providerName,
	}
	featureService := &services.FeatureEngineeringService{DB: db}

	authHandler := handlers.AuthHandler{DB: db, JWTManager: jwtManager}
	tickerHandler := handlers.TickerHandler{DB: db, MLClient: ml}
	holdingHandler := handlers.HoldingHandler{DB: db}
	priceHandler := handlers.PriceHandler{DB: db, PriceIngestionSV: priceIngestionService}
	featureHandler := handlers.FeatureHandler{DB: db, FeatureSV: featureService}
	adminHandler := handlers.AdminHandler{
		DB:                db,
		CredentialService: credentialService,
		PriceIngestionSV:  priceIngestionService,
	}

	requireAuth := authmw.RequireAuth(jwtManager)

	r.Get("/health", handlers.Health)

	// Auth
	r.Route("/api/v1/auth", func(r chi.Router) {
		r.Post("/register", authHandler.Register)
		r.Post("/login", authHandler.Login)
		r.Post("/logout", authHandler.Logout)
		r.With(requireAuth).Get("/me", authHandler.Me)
	})

	r.Route("/api/v1", func(r chi.Router) {
		// Public read
		r.Get("/tickers", tickerHandler.ListTickers)
		r.Get("/tickers/{symbol}", tickerHandler.GetTickerBySymbol)
		r.Get("/tickers/{symbol}/prediction", tickerHandler.GetPredictionBySymbol)
		r.Get("/tickers/{symbol}/history", priceHandler.GetHistoricalPricesBySymbol)
		r.Get("/tickers/{symbol}/features", featureHandler.GetFeaturesBySymbol)

		// Authenticated
		r.Group(func(r chi.Router) {
			r.Use(requireAuth)

			// Holdings (full CRUD)
			r.Get("/holdings", holdingHandler.ListHoldings)
			r.Post("/holdings", holdingHandler.CreateHolding)
			r.Post("/holdings/by-symbol", holdingHandler.CreateHoldingBySymbol)
			r.Delete("/holdings/{id}", holdingHandler.DeleteHolding)

			// Provider / API key
			r.Get("/admin/provider-status", adminHandler.GetProviderStatus)
			r.Post("/admin/secrets/twelvedata", adminHandler.SetTwelveDataAPIKey)

			// Ticker management (bulk add from UI/registry)
			r.Post("/admin/tickers/bulk", tickerHandler.BulkUpsertTickers)

			// Manual ingest/backfill kept for admin use but no longer surfaced in UI
			r.Post("/admin/ingest/{symbol}/history", priceHandler.IngestHistoricalPricesBySymbol)
			r.Post("/admin/ingest/batch/history", adminHandler.BatchIngestHistory)
			r.Post("/admin/features/{symbol}/backfill", featureHandler.BackfillFeaturesBySymbol)
			r.Post("/admin/features/batch/backfill", adminHandler.BatchBackfillFeatures)
		})
	})

	return r
}
