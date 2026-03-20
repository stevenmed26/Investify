package main

import (
	"log"
	"net/http"

	"investify/apps/api/internal/config"
	"investify/apps/api/internal/db"
	"investify/apps/api/internal/router"
)

func main() {
	cfg := config.Load()

	pool, err := db.NewPostgresPool(cfg)
	if err != nil {
		log.Fatalf("failed to connect to database: %v", err)
	}
	defer pool.Close()

	r := router.New(cfg, pool)

	addr := ":" + cfg.Port
	log.Printf("api listening on %s", addr)

	if err := http.ListenAndServe(addr, r); err != nil {
		log.Fatalf("server failed: %v", err)
	}
}
