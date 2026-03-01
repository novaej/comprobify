# Next Steps

Features deferred from the SRI gap analysis. Implement when the core lifecycle is stable and in production.

## ~~Idempotency Key~~ ✅ Done

Implemented in migration 021 and `src/middleware/idempotency.js`:
- `Idempotency-Key` header on `POST /api/invoices`
- SHA-256 payload hash stored alongside the key — same key + same body → `200` replay; same key + different body → `409 Conflict`
- Concurrent race handled: `23505` unique violation caught in the transaction rollback path, fetches the winner and returns it as a replay
- `src/errors/conflict-error.js` — new `AppError` subclass (409)

---

## Authentication & Authorization

- API key or JWT authentication middleware
- Role-based access control (admin, issuer, read-only)
- Per-issuer API keys stored in DB

## Additional Document Types

Builders for document type codes:
- `03` — Liquidación de compra
- `04` — Nota de crédito
- `05` — Nota de débito
- `06` — Guía de remisión
- `07` — Comprobante de retención

## ~~Email Delivery~~ ✅ Done

Implemented in migration 019–020 and `src/services/email/`:
- RIDE PDF + authorization XML sent on `AUTHORIZED` (fire-and-forget, no storage)
- Mailgun provider via `mailgun.js`; swap by adding a new file in `src/services/email/providers/`
- Per-document `email_status` tracking: `PENDING` → `SENT` / `FAILED` / `SKIPPED`
- Batch retry: `POST /api/invoices/email-retry`
- Single retry: `POST /api/invoices/:accessKey/email-retry`
- XML download: `GET /api/invoices/:accessKey/xml`

Remaining: issuer logo (`logo_path`) not yet rendered in emails (column exists in `issuers` via migration 018).

## Reporting Module

- Endpoints for revenue summaries, document counts by status/date/issuer
- Export to CSV/Excel

## Async Queue (Worker)

- Background worker for send + authorize steps (bull or pg-boss)
- Removes SRI network latency from HTTP response path
- Dead-letter queue for permanently failed documents

## Docker / Containers

- `Dockerfile` and `docker-compose.yml` with app + PostgreSQL
- Health check endpoint (`GET /health`)

## OpenAPI / Swagger

- `openapi.yaml` spec for all endpoints
- Swagger UI served at `/docs`
