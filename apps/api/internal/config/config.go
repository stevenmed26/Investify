package config

import (
	"log"
	"os"
)

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
	jwtSecret := os.Getenv("JWT_SECRET")
	if jwtSecret == "" {
		jwtSecret = "dev-jwt-secret"
		warnInsecureDefault("JWT_SECRET")
	}

	encKey := os.Getenv("APP_ENCRYPTION_KEY")
	if encKey == "" {
		encKey = "dev-encryption-secret"
		warnInsecureDefault("APP_ENCRYPTION_KEY")
	}

	return Config{
		Port:             getEnv("API_PORT", "8080"),
		DBHost:           getEnv("API_DB_HOST", "localhost"),
		DBPort:           getEnv("API_DB_PORT", "5432"),
		DBName:           getEnv("API_DB_NAME", "investify"),
		DBUser:           getEnv("API_DB_USER", "investify"),
		DBPassword:       getEnv("API_DB_PASSWORD", "investify"),
		MLBaseURL:        getEnv("API_ML_BASE_URL", "http://localhost:8000"),
		JWTSecret:        jwtSecret,
		AppEncryptionKey: encKey,
	}
}

func warnInsecureDefault(key string) {
	env := os.Getenv("APP_ENV")
	if env == "production" || env == "prod" {
		log.Fatalf("FATAL: %s must be set in production. Refusing to start with an insecure default.", key)
	}
	log.Printf("WARNING: %s is not set. Using insecure default — do NOT run this in production.", key)
}
