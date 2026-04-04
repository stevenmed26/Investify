# ── Build stage ──────────────────────────────────────────────────────────────
FROM python:3.12-slim AS builder

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt

# ── Runtime stage ─────────────────────────────────────────────────────────────
FROM python:3.12-slim

# curl needed for the docker-compose healthcheck
RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=builder /install /usr/local
COPY app/ ./app/

RUN mkdir -p artifacts

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
