package db

import (
	"context"
	"fmt"
	"time"

	"investify/apps/api/internal/config"

	"github.com/jackc/pgx/v5/pgxpool"
)

func NewPostgresPool(cfg config.Config) (*pgxpool.Pool, error) {
	dsn := fmt.Sprintf(
		"postgres://%s:%s@%s:%s/%s",
		cfg.DBUser,
		cfg.DBPassword,
		cfg.DBHost,
		cfg.DBPort,
		cfg.DBName,
	)

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	return pgxpool.New(ctx, dsn)
}
