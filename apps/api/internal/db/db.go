package db

import (
	"context"
	"fmt"
	"os"
	"time"

	"investify/apps/api/internal/config"

	"github.com/jackc/pgx/v5/pgxpool"
)

func NewPostgresPool(cfg config.Config) (*pgxpool.Pool, error) {

	sslMode := "disable"
	if env := os.Getenv("APP_ENV"); env == "production" || env == "prod" {
		sslMode = "require"
	}

	dsn := fmt.Sprintf(
		"postgres://%s:%s@%s:%s/%s?sslmode=%s",
		cfg.DBUser,
		cfg.DBPassword,
		cfg.DBHost,
		cfg.DBPort,
		cfg.DBName,
		sslMode,
	)

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	return pgxpool.New(ctx, dsn)
}
