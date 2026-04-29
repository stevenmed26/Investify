package jobs

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

type Status string

const (
	StatusQueued    Status = "queued"
	StatusRunning   Status = "running"
	StatusCompleted Status = "completed"
	StatusFailed    Status = "failed"
)

type Job struct {
	ID          string         `json:"id"`
	Service     string         `json:"service,omitempty"`
	Name        string         `json:"name"`
	Status      Status         `json:"status"`
	Message     string         `json:"message,omitempty"`
	Error       string         `json:"error,omitempty"`
	Result      map[string]any `json:"result,omitempty"`
	Metadata    map[string]any `json:"metadata,omitempty"`
	CreatedAt   time.Time      `json:"created_at"`
	StartedAt   *time.Time     `json:"started_at,omitempty"`
	CompletedAt *time.Time     `json:"completed_at,omitempty"`
	UpdatedAt   time.Time      `json:"updated_at"`
}

type Manager struct {
	db      *pgxpool.Pool
	service string
}

func NewManager(db *pgxpool.Pool) *Manager {
	return &Manager{
		db:      db,
		service: "api",
	}
}

func (m *Manager) Create(name, message string) Job {
	now := time.Now().UTC()
	job := Job{
		ID:        newID(),
		Service:   m.service,
		Name:      name,
		Status:    StatusQueued,
		Message:   message,
		Metadata:  map[string]any{},
		CreatedAt: now,
		UpdatedAt: now,
	}

	if err := m.insert(job); err != nil {
		// Keep handler behavior simple: return a usable job id even if persistence
		// fails. Subsequent status lookups will surface "not found".
		return job
	}
	return job
}

func (m *Manager) Get(id string) (Job, bool) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	var job Job
	var resultBytes []byte
	var metadataBytes []byte

	err := m.db.QueryRow(ctx, `
		SELECT
			id,
			service,
			name,
			status,
			COALESCE(message, ''),
			COALESCE(error, ''),
			COALESCE(result_json, '{}'::jsonb),
			COALESCE(metadata_json, '{}'::jsonb),
			created_at,
			started_at,
			completed_at,
			updated_at
		FROM pipeline_jobs
		WHERE id = $1
	`, id).Scan(
		&job.ID,
		&job.Service,
		&job.Name,
		&job.Status,
		&job.Message,
		&job.Error,
		&resultBytes,
		&metadataBytes,
		&job.CreatedAt,
		&job.StartedAt,
		&job.CompletedAt,
		&job.UpdatedAt,
	)
	if err != nil {
		return Job{}, false
	}

	job.Result = decodeMap(resultBytes)
	job.Metadata = decodeMap(metadataBytes)
	return job, true
}

func (m *Manager) List(service, status string, limit int) ([]Job, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}

	service = strings.TrimSpace(service)
	status = strings.TrimSpace(status)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	rows, err := m.db.Query(ctx, `
		SELECT
			id,
			service,
			name,
			status,
			COALESCE(message, ''),
			COALESCE(error, ''),
			COALESCE(result_json, '{}'::jsonb),
			COALESCE(metadata_json, '{}'::jsonb),
			created_at,
			started_at,
			completed_at,
			updated_at
		FROM pipeline_jobs
		WHERE ($1 = '' OR service = $1)
		  AND ($2 = '' OR status = $2)
		ORDER BY created_at DESC
		LIMIT $3
	`, service, status, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	jobs := make([]Job, 0)
	for rows.Next() {
		var job Job
		var resultBytes []byte
		var metadataBytes []byte

		if err := rows.Scan(
			&job.ID,
			&job.Service,
			&job.Name,
			&job.Status,
			&job.Message,
			&job.Error,
			&resultBytes,
			&metadataBytes,
			&job.CreatedAt,
			&job.StartedAt,
			&job.CompletedAt,
			&job.UpdatedAt,
		); err != nil {
			return nil, err
		}

		job.Result = decodeMap(resultBytes)
		job.Metadata = decodeMap(metadataBytes)
		jobs = append(jobs, job)
	}

	return jobs, rows.Err()
}

func (m *Manager) MarkRunning(id, message string) {
	now := time.Now().UTC()
	_ = m.update(id, map[string]any{
		"status":     StatusRunning,
		"message":    message,
		"started_at": now,
		"updated_at": now,
	})
}

func (m *Manager) UpdateMessage(id, message string) {
	_ = m.update(id, map[string]any{
		"message":    message,
		"updated_at": time.Now().UTC(),
	})
}

func (m *Manager) MarkCompleted(id, message string, result map[string]any) {
	now := time.Now().UTC()
	_ = m.update(id, map[string]any{
		"status":       StatusCompleted,
		"message":      message,
		"error":        "",
		"result_json":  result,
		"completed_at": now,
		"updated_at":   now,
	})
}

func (m *Manager) MarkFailed(id, message, err string) {
	now := time.Now().UTC()
	_ = m.update(id, map[string]any{
		"status":       StatusFailed,
		"message":      message,
		"error":        err,
		"completed_at": now,
		"updated_at":   now,
	})
}

func (m *Manager) insert(job Job) error {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	metadata, err := json.Marshal(job.Metadata)
	if err != nil {
		return fmt.Errorf("marshal metadata: %w", err)
	}

	_, err = m.db.Exec(ctx, `
		INSERT INTO pipeline_jobs (
			id, service, name, status, message, metadata_json, created_at, updated_at
		)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
	`, job.ID, job.Service, job.Name, job.Status, job.Message, metadata, job.CreatedAt, job.UpdatedAt)
	return err
}

func (m *Manager) update(id string, changes map[string]any) error {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	switch changes["status"] {
	case StatusRunning:
		_, err := m.db.Exec(ctx, `
			UPDATE pipeline_jobs
			SET status = $2, message = $3, started_at = COALESCE(started_at, $4), updated_at = $5
			WHERE id = $1
		`, id, changes["status"], changes["message"], changes["started_at"], changes["updated_at"])
		return err
	case StatusCompleted:
		result, err := json.Marshal(changes["result_json"])
		if err != nil {
			return fmt.Errorf("marshal result: %w", err)
		}
		_, err = m.db.Exec(ctx, `
			UPDATE pipeline_jobs
			SET status = $2, message = $3, error = $4, result_json = $5,
			    completed_at = $6, updated_at = $7
			WHERE id = $1
		`, id, changes["status"], changes["message"], changes["error"], result, changes["completed_at"], changes["updated_at"])
		return err
	case StatusFailed:
		_, err := m.db.Exec(ctx, `
			UPDATE pipeline_jobs
			SET status = $2, message = $3, error = $4, completed_at = $5, updated_at = $6
			WHERE id = $1
		`, id, changes["status"], changes["message"], changes["error"], changes["completed_at"], changes["updated_at"])
		return err
	default:
		_, err := m.db.Exec(ctx, `
			UPDATE pipeline_jobs
			SET message = $2, updated_at = $3
			WHERE id = $1
		`, id, changes["message"], changes["updated_at"])
		return err
	}
}

func decodeMap(raw []byte) map[string]any {
	if len(raw) == 0 {
		return map[string]any{}
	}

	var out map[string]any
	if err := json.Unmarshal(raw, &out); err != nil {
		return map[string]any{}
	}
	return out
}

func newID() string {
	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err != nil {
		return hex.EncodeToString([]byte(time.Now().UTC().Format("20060102150405.000000000")))
	}
	return hex.EncodeToString(buf)
}
