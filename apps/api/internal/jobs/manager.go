package jobs

import (
	"crypto/rand"
	"encoding/hex"
	"sync"
	"time"
)

type Status string

const (
	StatusQueued    Status = "queued"
	StatusRunning   Status = "running"
	StatusCompleted Status = "completed"
	StatusFailed    Status = "failed"
)

type Job struct {
	ID          string     `json:"id"`
	Name        string     `json:"name"`
	Status      Status     `json:"status"`
	Message     string     `json:"message,omitempty"`
	Error       string     `json:"error,omitempty"`
	Result      any        `json:"result,omitempty"`
	CreatedAt   time.Time  `json:"created_at"`
	StartedAt   *time.Time `json:"started_at,omitempty"`
	CompletedAt *time.Time `json:"completed_at,omitempty"`
}

type Manager struct {
	mu   sync.RWMutex
	jobs map[string]*Job
}

func NewManager() *Manager {
	return &Manager{
		jobs: make(map[string]*Job),
	}
}

func (m *Manager) Create(name, message string) Job {
	job := Job{
		ID:        newID(),
		Name:      name,
		Status:    StatusQueued,
		Message:   message,
		CreatedAt: time.Now().UTC(),
	}

	m.mu.Lock()
	m.jobs[job.ID] = &job
	m.mu.Unlock()

	return job
}

func (m *Manager) Get(id string) (Job, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	job, ok := m.jobs[id]
	if !ok {
		return Job{}, false
	}

	return *job, true
}

func (m *Manager) MarkRunning(id, message string) {
	m.update(id, func(job *Job) {
		now := time.Now().UTC()
		job.Status = StatusRunning
		job.Message = message
		job.StartedAt = &now
	})
}

func (m *Manager) UpdateMessage(id, message string) {
	m.update(id, func(job *Job) {
		job.Message = message
	})
}

func (m *Manager) MarkCompleted(id, message string, result any) {
	m.update(id, func(job *Job) {
		now := time.Now().UTC()
		job.Status = StatusCompleted
		job.Message = message
		job.Result = result
		job.Error = ""
		job.CompletedAt = &now
	})
}

func (m *Manager) MarkFailed(id, message, err string) {
	m.update(id, func(job *Job) {
		now := time.Now().UTC()
		job.Status = StatusFailed
		job.Message = message
		job.Error = err
		job.CompletedAt = &now
	})
}

func (m *Manager) update(id string, apply func(*Job)) {
	m.mu.Lock()
	defer m.mu.Unlock()

	job, ok := m.jobs[id]
	if !ok {
		return
	}

	apply(job)
}

func newID() string {
	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err != nil {
		return hex.EncodeToString([]byte(time.Now().UTC().Format("20060102150405.000000000")))
	}
	return hex.EncodeToString(buf)
}
