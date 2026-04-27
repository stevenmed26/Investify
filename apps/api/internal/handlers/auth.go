package handlers

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"investify/apps/api/internal/auth"
	"investify/apps/api/internal/middleware"

	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/crypto/bcrypt"
)

type AuthHandler struct {
	DB         *pgxpool.Pool
	JWTManager *auth.JWTManager
}

type authRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type authResponse struct {
	ID    string `json:"id"`
	Email string `json:"email"`
	Role  string `json:"role"`
}

func isSecureEnv() bool {
	env := os.Getenv("APP_ENV")
	return env == "production" || env == "prod"
}

func (h AuthHandler) Register(w http.ResponseWriter, r *http.Request) {
	var req authRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}

	req.Email = strings.TrimSpace(strings.ToLower(req.Email))
	if req.Email == "" || len(req.Password) < 8 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "email and password are required; password must be at least 8 characters"})
		return
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to hash password"})
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	var userID string
	var role string
	err = h.DB.QueryRow(ctx, `
		INSERT INTO users (email, password_hash, role, created_at, updated_at)
		VALUES ($1, $2, 'member', $3, $4)
		RETURNING id, role
	`, req.Email, string(hash), time.Now().UTC(), time.Now().UTC()).Scan(&userID, &role)
	if err != nil {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "user already exists or registration failed"})
		return
	}

	token, err := h.JWTManager.Generate(userID, req.Email, role)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to generate session"})
		return
	}

	http.SetCookie(w, &http.Cookie{
		Name:     auth.CookieName,
		Value:    token,
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Secure:   isSecureEnv(), // FIX 6
		MaxAge:   7 * 24 * 3600,
	})

	log.Printf("[auth] register success email=%s user_id=%s", req.Email, userID)

	writeJSON(w, http.StatusCreated, authResponse{ID: userID, Email: req.Email, Role: role})
}

func (h AuthHandler) Login(w http.ResponseWriter, r *http.Request) {
	var req authRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}

	req.Email = strings.TrimSpace(strings.ToLower(req.Email))
	if req.Email == "" || req.Password == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "email and password are required"})
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	var userID string
	var passwordHash string
	var role string
	err := h.DB.QueryRow(ctx, `
		SELECT id, password_hash, role
		FROM users
		WHERE email = $1
	`, req.Email).Scan(&userID, &passwordHash, &role)
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "invalid credentials"})
		return
	}

	if err := bcrypt.CompareHashAndPassword([]byte(passwordHash), []byte(req.Password)); err != nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "invalid credentials"})
		return
	}

	token, err := h.JWTManager.Generate(userID, req.Email, role)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to generate session"})
		return
	}

	http.SetCookie(w, &http.Cookie{
		Name:     auth.CookieName,
		Value:    token,
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Secure:   isSecureEnv(), // FIX 6
		MaxAge:   7 * 24 * 3600,
	})

	log.Printf("[auth] login success email=%s user_id=%s", req.Email, userID)

	writeJSON(w, http.StatusOK, authResponse{ID: userID, Email: req.Email, Role: role})
}

func (h AuthHandler) Logout(w http.ResponseWriter, r *http.Request) {
	http.SetCookie(w, &http.Cookie{
		Name:     auth.CookieName,
		Value:    "",
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Secure:   isSecureEnv(), // FIX 6
		MaxAge:   -1,
	})

	writeJSON(w, http.StatusOK, map[string]any{
		"status": "ok",
	})
}

func (h AuthHandler) Me(w http.ResponseWriter, r *http.Request) {
	user, ok := middleware.GetAuthUser(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"id":    user.UserID,
		"email": user.Email,
		"role":  user.Role,
	})
}
