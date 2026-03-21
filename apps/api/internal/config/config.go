package config

import "os"

type Config struct {
	Port             string
	DBHost           string
	DBPort           string
	DBName           string
	DBUser           string
	DBPassword       string
	MLBaseURL        string
	JWTSecret        string
	AppEncryptionKey string
}

func getEnv(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}

func Load() Config {
	return Config{
		Port:             getEnv("API_PORT", "8080"),
		DBHost:           getEnv("API_DB_HOST", "localhost"),
		DBPort:           getEnv("API_DB_PORT", "5432"),
		DBName:           getEnv("API_DB_NAME", "investify"),
		DBUser:           getEnv("API_DB_USER", "investify"),
		DBPassword:       getEnv("API_DB_PASSWORD", "investify"),
		MLBaseURL:        getEnv("API_ML_BASE_URL", "http://localhost:8000"),
		JWTSecret:        getEnv("JWT_SECRET", "dev-jwt-secret"),
		AppEncryptionKey: getEnv("APP_ENCRYPTION_KEY", "dev-encryption-secret"),
	}
}
