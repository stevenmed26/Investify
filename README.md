# Investify

Investify is a local-first stock analysis platform for ingesting market data,
building technical indicators, training a shared ML model, and tracking a small
portfolio. The app is split into three services:

- `apps/web`: Next.js UI for market browsing, ticker detail pages, admin tools,
  and portfolio tracking.
- `apps/api`: Go API for auth, tickers, holdings, market-data ingestion,
  feature generation, background jobs, and the daily pipeline scheduler.
- `apps/ml-service`: FastAPI service for training and serving model
  predictions.

PostgreSQL stores users, tickers, holdings, historical prices, technical
features, encrypted provider credentials, and pipeline metadata.

## Architecture

```text
Browser
  |
  v
Next.js web (:3000)
  | public API calls with cookie auth
  v
Go API (:8080)  ---- internal token ---->  FastAPI ML service (:8000)
  |                                      |
  |                                      v
  +------------ PostgreSQL --------------+
```

The Go API is the main application boundary. It owns auth, database writes,
market-data ingestion, feature generation, and scheduled pipeline runs. The ML
service reads features from Postgres, persists trained `joblib` artifacts, and
returns predictions to the API.

## Repository Layout

```text
apps/api                  Go API service
apps/api/cmd/server       API entrypoint and scheduler startup
apps/api/cmd/hashpassword Local helper for bcrypt password hashes
apps/api/internal/router  Route wiring and middleware
apps/api/internal/handlers HTTP handlers
apps/api/internal/services Ingestion, feature, credential services
apps/api/internal/marketdata Twelve Data and dev providers
apps/api/internal/scheduler Daily pipeline runner

apps/ml-service           FastAPI ML service
apps/ml-service/app/routes Token-protected ML endpoints
apps/ml-service/app/services Dataset, training, prediction, model storage
apps/ml-service/artifacts Persisted model files

apps/web                  Next.js frontend
apps/web/src/app          Pages, API proxy route, components

apps/data/tickers.json    Registry synced into the DB on API startup
apps/migrations           SQL migrations mounted into Postgres on first init
docker-compose.yml        Local service orchestration
```

## Local Setup

1. Copy the sample environment file:

```powershell
Copy-Item .env.example .env
```

2. Edit `.env`.

At minimum for real Twelve Data ingestion:

```env
MARKET_DATA_PROVIDER=twelvedata
TWELVE_DATA_API_KEY=<system pipeline key>
ML_INTERNAL_TOKEN=<shared internal token>
JWT_SECRET=<long random value>
APP_ENCRYPTION_KEY=<long random value>
```

`APP_ENCRYPTION_KEY` is used to encrypt per-user Twelve Data keys stored in
`user_api_credentials`. Keep it stable for an existing database or those
credentials can no longer be decrypted.

3. Start the stack:

```powershell
docker compose up --build
```

4. Open:

- Web: `http://localhost:3000`
- API health: `http://localhost:8080/health`
- ML health: `http://localhost:8000/health`

Postgres initializes from `apps/migrations` only on first database creation. If
you change migrations and need a clean database, use `docker compose down -v`
and then start again.

## Dev Admin Account

Admin-only actions include batch ingest, feature backfill, ticker bulk upsert,
and training the shared model.

The app can seed a local admin user at API startup. It never stores a plaintext
password in source or SQL. Generate a bcrypt hash:

```powershell
cd apps/api
go run ./cmd/hashpassword
```

Enter your chosen password, then add the printed hash to `.env`:

```env
DEV_ADMIN_EMAIL=admin@investify.com
DEV_ADMIN_PASSWORD_HASH=<bcrypt hash>
```

Restart the API. In non-production environments the API will upsert that user,
set the role to `admin`, and update the password hash. This seed is skipped when
`APP_ENV=production` or `APP_ENV=prod`.

## Core Data Flow

1. **Ticker registry sync**
   On API startup, `apps/data/tickers.json` is synced into the `tickers` table.
   Existing symbols are updated, so the sync is safe to rerun.

2. **Historical price ingestion**
   Ingestion writes to `historical_prices`. With Twelve Data, the provider calls
   `/time_series` using `interval=1day` and an `outputsize`.

   Manual batch ingest is incremental: for each ticker, the API checks the most
   recent stored trading date. If the ticker is current, it skips the API call.
   If data is missing, it fetches only the missing trading days plus a five-day
   overlap buffer. Empty tickers fetch the requested history window, normally
   365 rows.

   Manual batch ingest waits 9000ms between tickers to stay below Twelve Data's
   8-calls-per-minute limit. The daily scheduler keeps its existing 7500ms
   delay.

3. **Feature backfill**
   Feature generation reads `historical_prices` and writes `technical_features`.
   It computes SMA, EMA, RSI, MACD, momentum, volatility, and volume ratio
   values. Prediction and training depend on these feature rows, not just raw
   price history.

4. **Model training**
   The ML service loads feature rows, joins them to prices, creates future
   returns with the configured horizon, drops rows missing required indicators,
   splits each ticker chronologically, labels rows by split-local quantiles, and
   trains a calibrated logistic regression model.

5. **Prediction**
   The API calls the ML service with an internal token. The ML service first
   tries the trained model for the requested horizon. If no trained model or
   usable feature row exists, it falls back to a rule-based prediction. If no
   technical features exist at all, it returns a neutral no-data sentinel.

## API Endpoints

### Public

- `GET /health`
- `GET /api/v1/tickers`
- `GET /api/v1/tickers/{symbol}`
- `GET /api/v1/tickers/{symbol}/prediction?horizon_days=5`
- `GET /api/v1/tickers/{symbol}/history?limit=180`
- `GET /api/v1/tickers/{symbol}/features?limit=30`

### Auth

Auth uses an HTTP-only cookie named `investify_token`.

- `POST /api/v1/auth/register`
- `POST /api/v1/auth/login`
- `POST /api/v1/auth/logout`
- `GET /api/v1/auth/me`

Auth endpoints are rate-limited to 10 attempts per minute per IP.

### Authenticated User

- `GET /api/v1/holdings`
- `POST /api/v1/holdings`
- `POST /api/v1/holdings/by-symbol`
- `DELETE /api/v1/holdings/{id}`
- `GET /api/v1/admin/provider-status`
- `POST /api/v1/admin/secrets/twelvedata`

Holdings always use the authenticated user from the JWT. Upserting an existing
holding adds shares and recomputes weighted average cost basis.

### Admin

- `POST /api/v1/admin/tickers/bulk`
- `POST /api/v1/admin/ingest/{symbol}/history?days=365`
- `POST /api/v1/admin/ingest/batch/history?days=365&delay_ms=9000`
- `POST /api/v1/admin/features/{symbol}/backfill`
- `POST /api/v1/admin/features/batch/backfill`
- `GET /api/v1/admin/jobs/{jobID}`

Batch ingest and feature backfill run as in-memory background jobs. Job history
is not persisted across API restarts.

## ML Service Endpoints

All ML service endpoints require `X-Internal-Token` matching
`ML_INTERNAL_TOKEN`.

- `GET /health`
- `POST /predict`
- `GET /models/current`
- `POST /train/jobs?horizon_days=5`
- `GET /train/jobs/{job_id}`

The Next.js route `apps/web/src/app/api/train/route.ts` proxies training jobs
from the browser to the ML service after confirming the current user is an
admin.

## Web App

- `/`: market list with search, sorting, lazy-loaded sparkline/prediction cards,
  and an optional "My Holdings" filter.
- `/ticker/[symbol]`: ticker detail page with price chart, projection overlay,
  model outlook, technical feature snapshot, add-holding form, and admin tools.
- `/profile`: authenticated portfolio view with holdings, market value,
  unrealized P/L, day change, and ML signal badges.
- Hamburger menu: login/register/logout, user role display, Twelve Data key
  storage, and navigation.

## Operating the Dev Pipeline

For local end-to-end data:

1. Sign in as an admin user.
2. Save a Twelve Data API key from the menu.
3. Run batch historical ingest.
4. Run feature backfill.
5. Train the model.
6. Refresh ticker pages to see updated predictions.

The daily scheduler also runs automatically from the API process at 22:00 UTC.
It uses `TWELVE_DATA_API_KEY` from `.env`, not a per-user saved credential.

## Why a Ticker Can Have Prices but No Prediction

Predictions need usable `technical_features`. A ticker with price rows can still
be excluded if feature backfill has not run, if indicators are still null, or if
there are not enough rows for SMA50 plus the prediction horizon. In practice,
seed history first, then generate features, then train.

Useful diagnostic query:

```sql
SELECT
  t.symbol,
  COUNT(DISTINCT hp.trading_date) AS price_rows,
  COUNT(DISTINCT tf.trading_date) AS feature_rows,
  MAX(hp.trading_date) AS latest_price,
  MAX(tf.trading_date) AS latest_feature
FROM tickers t
LEFT JOIN historical_prices hp ON hp.ticker_id = t.id
LEFT JOIN technical_features tf ON tf.ticker_id = t.id
WHERE t.symbol IN ('AIG', 'AKAM', 'ALB')
GROUP BY t.symbol
ORDER BY t.symbol;
```

## Development Commands

API:

```powershell
cd apps/api
$env:GOCACHE = Join-Path (Get-Location) ".gocache"
go test ./...
```

Web:

```powershell
cd apps/web
npm run build
```

ML service:

```powershell
cd apps/ml-service
python -m compileall app
```

Docker compose validation:

```powershell
docker compose config --quiet
```

## Notes and Caveats

- `apps/migrations` is the active Docker migration path. The top-level
  `db/migrations` folder may contain historical or branch-stash copies, but
  `docker-compose.yml` mounts `./apps/migrations`.
- The demo user seeded in `001_init.sql` has a placeholder password hash and is
  not a usable login by default.
- In-memory API and ML job registries are lost when their service restarts.
- Model artifacts are persisted in the Docker `ml_artifacts` volume.
- This project is for analysis and experimentation. Predictions are not
  financial advice.
