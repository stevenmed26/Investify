package middleware

import (
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"
)

// ipBucket tracks request timestamps for a single IP within a sliding window.
type ipBucket struct {
	mu         sync.Mutex
	timestamps []time.Time
}

// allow returns true if the request is within the allowed rate.
func (b *ipBucket) allow(max int, window time.Duration) bool {
	b.mu.Lock()
	defer b.mu.Unlock()

	cutoff := time.Now().Add(-window)
	fresh := b.timestamps[:0]
	for _, t := range b.timestamps {
		if t.After(cutoff) {
			fresh = append(fresh, t)
		}
	}
	b.timestamps = fresh

	if len(b.timestamps) >= max {
		return false
	}
	b.timestamps = append(b.timestamps, time.Now())
	return true
}

// RateLimiter holds per-IP sliding-window buckets.
type RateLimiter struct {
	mu      sync.Mutex
	buckets map[string]*ipBucket
	max     int
	window  time.Duration
}

// NewRateLimiter creates a limiter allowing max requests per window per IP.
// A background goroutine prunes stale buckets every 5 minutes.
func NewRateLimiter(max int, window time.Duration) *RateLimiter {
	rl := &RateLimiter{
		buckets: make(map[string]*ipBucket),
		max:     max,
		window:  window,
	}
	go rl.cleanup()
	return rl
}

func (rl *RateLimiter) getBucket(ip string) *ipBucket {
	rl.mu.Lock()
	defer rl.mu.Unlock()
	if b, ok := rl.buckets[ip]; ok {
		return b
	}
	b := &ipBucket{}
	rl.buckets[ip] = b
	return b
}

func (rl *RateLimiter) cleanup() {
	ticker := time.NewTicker(5 * time.Minute)
	defer ticker.Stop()
	for range ticker.C {
		cutoff := time.Now().Add(-rl.window)
		rl.mu.Lock()
		for ip, b := range rl.buckets {
			b.mu.Lock()
			active := false
			for _, t := range b.timestamps {
				if t.After(cutoff) {
					active = true
					break
				}
			}
			b.mu.Unlock()
			if !active {
				delete(rl.buckets, ip)
			}
		}
		rl.mu.Unlock()
	}
}

func clientIP(r *http.Request) string {
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		return strings.TrimSpace(strings.SplitN(xff, ",", 2)[0])
	}
	if xri := r.Header.Get("X-Real-IP"); xri != "" {
		return strings.TrimSpace(xri)
	}
	addr := r.RemoteAddr
	if idx := strings.LastIndex(addr, ":"); idx != -1 {
		return addr[:idx]
	}
	return addr
}

// Limit returns an http.Handler middleware enforcing the rate limit.
// Requests over the limit receive 429 Too Many Requests.
func (rl *RateLimiter) Limit(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ip := clientIP(r)
		if !rl.getBucket(ip).allow(rl.max, rl.window) {
			w.Header().Set("Content-Type", "application/json")
			w.Header().Set("Retry-After", fmt.Sprintf("%d", int(rl.window.Seconds())))
			w.WriteHeader(http.StatusTooManyRequests)
			_, _ = w.Write([]byte(`{"error":"too many requests — please wait before trying again"}`))
			return
		}
		next.ServeHTTP(w, r)
	})
}
