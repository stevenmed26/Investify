package services

import (
	"context"
	"fmt"
	"log"
	"strings"
	"time"

	"investify/apps/api/internal/security"

	"github.com/jackc/pgx/v5/pgxpool"
)

type CredentialService struct {
	DB        *pgxpool.Pool
	Encryptor *security.Encryptor
}

func (s *CredentialService) UpsertAPIKey(ctx context.Context, userID, provider, apiKey string) error {
	provider = strings.ToLower(strings.TrimSpace(provider))
	if userID == "" || provider == "" || apiKey == "" {
		return fmt.Errorf("userID, provider, and apiKey are required")
	}

	encrypted, err := s.Encryptor.Encrypt(apiKey)
	if err != nil {
		return fmt.Errorf("encrypt api key: %w", err)
	}

	log.Printf("[credentials] upsert provider=%s user_id=%s", provider, userID)

	_, err = s.DB.Exec(ctx, `
		INSERT INTO user_api_credentials (
			user_id,
			provider,
			encrypted_api_key,
			created_at,
			updated_at
		)
		VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (user_id, provider)
		DO UPDATE SET
			encrypted_api_key = EXCLUDED.encrypted_api_key,
			updated_at = EXCLUDED.updated_at
	`, userID, provider, encrypted, time.Now().UTC(), time.Now().UTC())
	if err != nil {
		return fmt.Errorf("upsert credential: %w", err)
	}

	return nil
}

func (s *CredentialService) HasAPIKey(ctx context.Context, userID, provider string) (bool, error) {
	provider = strings.ToLower(strings.TrimSpace(provider))

	var exists bool
	err := s.DB.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1
			FROM user_api_credentials
			WHERE user_id = $1 AND provider = $2
		)
	`, userID, provider).Scan(&exists)
	if err != nil {
		return false, fmt.Errorf("check credential existence: %w", err)
	}

	return exists, nil
}

func (s *CredentialService) GetAPIKey(ctx context.Context, userID, provider string) (string, error) {
	provider = strings.ToLower(strings.TrimSpace(provider))

	var encrypted string
	err := s.DB.QueryRow(ctx, `
		SELECT encrypted_api_key
		FROM user_api_credentials
		WHERE user_id = $1 AND provider = $2
	`, userID, provider).Scan(&encrypted)
	if err != nil {
		return "", fmt.Errorf("fetch credential: %w", err)
	}

	plaintext, err := s.Encryptor.Decrypt(encrypted)
	if err != nil {
		return "", fmt.Errorf("decrypt credential: %w", err)
	}

	return plaintext, nil
}
