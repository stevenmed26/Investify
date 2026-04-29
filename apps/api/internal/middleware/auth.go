package middleware

import (
	"context"
	"encoding/json"
	"net"
	"net/http"
	"strings"

	"investify/apps/api/internal/auth"
	"investify/apps/api/internal/config"
	"investify/apps/api/internal/local"
)

type contextKey string

const userContextKey contextKey = "auth_user"

type AuthUser struct {
	UserID string
	Email  string
	Role   string
}

func RequireAuthForConfig(cfg config.Config, jwtManager *auth.JWTManager) func(http.Handler) http.Handler {
	if strings.EqualFold(cfg.AuthMode, "local") {
		return RequireLocalAuth(cfg.LocalAdminToken)
	}
	return RequireAuth(jwtManager)
}

func RequireLocalAuth(localToken string) func(http.Handler) http.Handler {
	localToken = strings.TrimSpace(localToken)
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if localToken != "" && r.Header.Get("X-Local-Token") != localToken && !isLocalRequest(r) {
				writeAuthError(w, http.StatusUnauthorized, "unauthorized")
				return
			}
			if localToken == "" && !isLocalRequest(r) {
				writeAuthError(w, http.StatusUnauthorized, "unauthorized")
				return
			}

			ctx := context.WithValue(r.Context(), userContextKey, AuthUser{
				UserID: local.OperatorUserID,
				Email:  local.OperatorEmail,
				Role:   local.OperatorRole,
			})
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

func RequireAuth(jwtManager *auth.JWTManager) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			cookie, err := r.Cookie(auth.CookieName)
			if err != nil || cookie.Value == "" {
				writeAuthError(w, http.StatusUnauthorized, "unauthorized")
				return
			}

			claims, err := jwtManager.Parse(cookie.Value)
			if err != nil {
				writeAuthError(w, http.StatusUnauthorized, "unauthorized")
				return
			}

			ctx := context.WithValue(r.Context(), userContextKey, AuthUser{
				UserID: claims.UserID,
				Email:  claims.Email,
				Role:   claims.Role,
			})

			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

func GetAuthUser(ctx context.Context) (AuthUser, bool) {
	user, ok := ctx.Value(userContextKey).(AuthUser)
	return user, ok
}

func isLocalRequest(r *http.Request) bool {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err == nil {
		ip := net.ParseIP(host)
		if ip != nil && ip.IsLoopback() {
			return true
		}
	}

	origin := r.Header.Get("Origin")
	if origin == "" {
		return false
	}
	return strings.HasPrefix(origin, "http://localhost:") ||
		strings.HasPrefix(origin, "http://127.0.0.1:") ||
		strings.HasPrefix(origin, "http://[::1]:")
}

func writeAuthError(w http.ResponseWriter, status int, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": message})
}
