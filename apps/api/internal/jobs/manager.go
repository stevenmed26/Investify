package jobs

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
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
	Payload     map[string]any `json:"payload,omitempty"`
	Result      map[string]any `json:"result,omitempty"`
	Metadata    map[string]any `json:"metadata,omitempty"`
	Attempts    int            `json:"attempts"`
	MaxAttempts int            `json:"max_attempts"`
	AvailableAt time.Time      `json:"available_at"`
	LockedAt    *time.Time     `json:"locked_at,omitempty"`
	LockedBy    string         `json:"locked_by,omitempty"`
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

func (m *Manager) Create(name, message string) (Job, error) {
	return m.CreateWithPayload(name, message, nil, nil, 3)
}

func (m *Manager) CreateWithPayload(name, message string, payload, metadata map[string]any, maxAttempts int) (Job, error) {
	now := time.Now().UTC()
	if payload == nil {
		payload = map[string]any{}
	}
	if metadata == nil {
		metadata = map[string]any{}
	}
	if maxAttempts <= 0 {
		maxAttempts = 3
	}

	job := Job{
		ID:          newID(),
		Service:     m.service,
		Name:        name,
		Status:      StatusQueued,
		Message:     message,
		Payload:     payload,
		Metadata:    metadata,
		MaxAttempts: maxAttempts,
		AvailableAt: now,
		CreatedAt:   now,
		UpdatedAt:   now,
	}

	if err := m.insert(job); err != nil {
		return Job{}, err
	}
	return job, nil
}

func (m *Manager) Get(id string) (Job, bool) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	job, err := m.get(ctx, id)
	if err != nil {
		return Job{}, false
	}
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
			COALESCE(payload_json, '{}'::jsonb),
			COALESCE(result_json, '{}'::jsonb),
			COALESCE(metadata_json, '{}'::jsonb),
			attempts,
			max_attempts,
			available_at,
			locked_at,
			COALESCE(locked_by, ''),
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
		job, err := scanJob(rows)
		if err != nil {
			return nil, err
		}
		jobs = append(jobs, job)
	}

	return jobs, rows.Err()
}

func (m *Manager) ClaimNext(workerID string, names []string) (Job, bool, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	names = normalizeNames(names)
	if workerID == "" {
		workerID = "api-worker"
	}

	row := m.db.QueryRow(ctx, `
		WITH next_job AS (
			SELECT id
			FROM pipeline_jobs
			WHERE service = $1
			  AND status = $2
			  AND available_at <= NOW()
			  AND (cardinality($3::text[]) = 0 OR name = ANY($3::text[]))
			ORDER BY available_at ASC, created_at ASC
			FOR UPDATE SKIP LOCKED
			LIMIT 1
		)
		UPDATE pipeline_jobs pj
		SET status = $4,
			message = 'Job is running.',
			attempts = attempts + 1,
			locked_at = NOW(),
			locked_by = $5,
			started_at = COALESCE(started_at, NOW()),
			updated_at = NOW()
		FROM next_job
		WHERE pj.id = next_job.id
		RETURNING
			pj.id,
			pj.service,
			pj.name,
			pj.status,
			COALESCE(pj.message, ''),
			COALESCE(pj.error, ''),
			COALESCE(pj.payload_json, '{}'::jsonb),
			COALESCE(pj.result_json, '{}'::jsonb),
			COALESCE(pj.metadata_json, '{}'::jsonb),
			pj.attempts,
			pj.max_attempts,
			pj.available_at,
			pj.locked_at,
			COALESCE(pj.locked_by, ''),
			pj.created_at,
			pj.started_at,
			pj.completed_at,
			pj.updated_at
	`, m.service, StatusQueued, names, StatusRunning, workerID)

	job, err := scanJob(row)
	if err != nil {
		if err == pgx.ErrNoRows {
			return Job{}, false, nil
		}
		return Job{}, false, err
	}
	return job, true, nil
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

func (m *Manager) MarkRetry(id, message, err string, delay time.Duration) {
	now := time.Now().UTC()
	_ = m.update(id, map[string]any{
		"status":       StatusQueued,
		"message":      message,
		"error":        err,
		"available_at": now.Add(delay),
		"updated_at":   now,
	})
}

func (m *Manager) get(ctx context.Context, id string) (Job, error) {
	var job Job
	var payloadBytes []byte
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
			COALESCE(payload_json, '{}'::jsonb),
			COALESCE(result_json, '{}'::jsonb),
			COALESCE(metadata_json, '{}'::jsonb),
			attempts,
			max_attempts,
			available_at,
			locked_at,
			COALESCE(locked_by, ''),
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
		&payloadBytes,
		&resultBytes,
		&metadataBytes,
		&job.Attempts,
		&job.MaxAttempts,
		&job.AvailableAt,
		&job.LockedAt,
		&job.LockedBy,
		&job.CreatedAt,
		&job.StartedAt,
		&job.CompletedAt,
		&job.UpdatedAt,
	)
	if err != nil {
		return Job{}, err
	}

	job.Payload = decodeMap(payloadBytes)
	job.Result = decodeMap(resultBytes)
	job.Metadata = decodeMap(metadataBytes)
	return job, nil
}

func (m *Manager) insert(job Job) error {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	payload, err := json.Marshal(job.Payload)
	if err != nil {
		return fmt.Errorf("marshal payload: %w", err)
	}
	metadata, err := json.Marshal(job.Metadata)
	if err != nil {
		return fmt.Errorf("marshal metadata: %w", err)
	}

	_, err = m.db.Exec(ctx, `
		INSERT INTO pipeline_jobs (
			id, service, name, status, message, payload_json, metadata_json,
			max_attempts, available_at, created_at, updated_at
		)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
	`, job.ID, job.Service, job.Name, job.Status, job.Message, payload, metadata, job.MaxAttempts, job.AvailableAt, job.CreatedAt, job.UpdatedAt)
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
			    completed_at = $6, updated_at = $7, locked_at = NULL, locked_by = NULL
			WHERE id = $1
		`, id, changes["status"], changes["message"], changes["error"], result, changes["completed_at"], changes["updated_at"])
		return err
	case StatusFailed:
		_, err := m.db.Exec(ctx, `
			UPDATE pipeline_jobs
			SET status = $2, message = $3, error = $4, completed_at = $5, updated_at = $6,
			    locked_at = NULL, locked_by = NULL
			WHERE id = $1
		`, id, changes["status"], changes["message"], changes["error"], changes["completed_at"], changes["updated_at"])
		return err
	case StatusQueued:
		_, err := m.db.Exec(ctx, `
			UPDATE pipeline_jobs
			SET status = $2, message = $3, error = $4, available_at = $5, updated_at = $6,
			    locked_at = NULL, locked_by = NULL
			WHERE id = $1
		`, id, changes["status"], changes["message"], changes["error"], changes["available_at"], changes["updated_at"])
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

type jobScanner interface {
	Scan(dest ...any) error
}

func scanJob(row jobScanner) (Job, error) {
	var job Job
	var payloadBytes []byte
	var resultBytes []byte
	var metadataBytes []byte

	if err := row.Scan(
		&job.ID,
		&job.Service,
		&job.Name,
		&job.Status,
		&job.Message,
		&job.Error,
		&payloadBytes,
		&resultBytes,
		&metadataBytes,
		&job.Attempts,
		&job.MaxAttempts,
		&job.AvailableAt,
		&job.LockedAt,
		&job.LockedBy,
		&job.CreatedAt,
		&job.StartedAt,
		&job.CompletedAt,
		&job.UpdatedAt,
	); err != nil {
		return Job{}, err
	}

	job.Payload = decodeMap(payloadBytes)
	job.Result = decodeMap(resultBytes)
	job.Metadata = decodeMap(metadataBytes)
	return job, nil
}

func normalizeNames(names []string) []string {
	out := make([]string, 0, len(names))
	seen := map[string]struct{}{}
	for _, name := range names {
		name = strings.TrimSpace(name)
		if name == "" {
			continue
		}
		if _, ok := seen[name]; ok {
			continue
		}
		seen[name] = struct{}{}
		out = append(out, name)
	}
	return out
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
