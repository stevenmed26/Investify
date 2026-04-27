# ── Build stage ──────────────────────────────────────────────────────────────
FROM golang:1.24-alpine AS builder

WORKDIR /app

COPY api/go.mod api/go.sum ./
RUN go mod download

COPY api/ ./
COPY data/ ./data/
RUN CGO_ENABLED=0 GOOS=linux go build -o server ./cmd/server

# ── Runtime stage ─────────────────────────────────────────────────────────────
FROM alpine:3.20

RUN apk add --no-cache ca-certificates tzdata

WORKDIR /app
COPY --from=builder /app/server .

# tickers.json lives at apps/data/ — copied in via the expanded build context
COPY data/ ./data/

EXPOSE 8080

CMD ["./server"]
