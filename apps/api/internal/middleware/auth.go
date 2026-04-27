package middleware

import (
	"context"
	"encoding/json"
	"net/http"

	"investify/apps/api/internal/auth"
)

type contextKey string

const userContextKey contextKey = "auth_user"

type AuthUser struct {
	UserID string
	Email  string
	Role   string
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

func RequireAdmin(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		user, ok := GetAuthUser(r.Context())
		if !ok {
			writeAuthError(w, http.StatusUnauthorized, "unauthorized")
			return
		}

		if user.Role != "admin" {
			writeAuthError(w, http.StatusForbidden, "forbidden")
			return
		}

		next.ServeHTTP(w, r)
	})
}

func writeAuthError(w http.ResponseWriter, status int, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": message})
}
